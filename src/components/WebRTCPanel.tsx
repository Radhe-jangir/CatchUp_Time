import React, { useState, useEffect, useRef } from "react";
import { Member } from "../types";
import { Camera, CameraOff, Mic, MicOff, Monitor, MonitorOff, Video, Users, Volume2 } from "lucide-react";

interface WebRTCPanelProps {
  socket: any; // SocketIO Client Instance
  members: Member[];
  myId: string;
  roomId: string;
  onScreenShareStream: (stream: MediaStream | null, userNameStr: string) => void;
}

interface PeerConnectionData {
  pc: RTCPeerConnection;
  socketId: string;
}

export default function WebRTCPanel({
  socket,
  members,
  myId,
  roomId,
  onScreenShareStream,
}: WebRTCPanelProps) {
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);

  // Streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Array<{ socketId: string; name: string; stream: MediaStream }>
  >([]);

  // Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnectionData>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  // Audio meters for active speaker detection
  const [activeSpeakers, setActiveSpeakers] = useState<Record<string, boolean>>({});
  const audioContextsRef = useRef<Map<string, { interval: any; node: AnalyserNode }>>(new Map());

  // Google public STUN servers for NAT-buster connections with optimized candidate bundling & pre-gathering
  const iceConfiguration: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302"
      ]
    }
  ]
};

  // Turn off all streams on unmount
  useEffect(() => {
    return () => {
      stopLocalStream();
      stopLocalScreenShare();
      closeAllPeers();
      audioContextsRef.current.forEach((meter) => {
        clearInterval(meter.interval);
      });
    };
  }, []);

  // Sync state to WebSockets whenever toggles are mutated
  useEffect(() => {
    if (socket) {
      socket.emit("stream-state-changed", {
        cameraOn,
        micOn,
        isSharingScreen,
        webcamStreamId: localStreamRef.current?.id || null,
        screenStreamId: localScreenStreamRef.current?.id || null,
      });
    }
  }, [cameraOn, micOn, isSharingScreen, localStream, socket]);

  // Re-evaluate remote streams classification whenever members list gets updated
  useEffect(() => {
    setRemoteStreams((prev) => {
      let changed = false;
      const updated = prev.map((item) => {
        // Strip out "-screen" to find base socket id
        const baseId = item.socketId.replace("-screen", "");
        const member = members.find((m) => m.id === baseId);
        if (!member) return item;

        const isScreen = !!(member.screenStreamId && item.stream.id === member.screenStreamId);
        const expectedId = isScreen ? `${baseId}-screen` : baseId;
        const expectedName = isScreen ? `${member.name} (Screen)` : member.name;

        if (item.socketId !== expectedId || item.name !== expectedName) {
          changed = true;
          return { ...item, socketId: expectedId, name: expectedName };
        }
        return item;
      });

      if (changed) {
        (window as any)._remoteStreams = updated;
        return updated;
      }
      return prev;
    });
  }, [members]);

  // Read WebSockets WebRTC signaling channels
  useEffect(() => {
    if (!socket) return;

    // Handles incoming signaling sdp / candidates
    const handleSignal = async ({ from, signal, type, fromSenderName }: any) => {
      try {
        let peerData = peersRef.current.get(from);

        if (!peerData) {
          // If connection doesn't exist, create one
          peerData = createPeerConnection(from, fromSenderName);
        }

        const { pc } = peerData;

        if (signal.sdp) {
          if (
            pc.signalingState === "have-local-offer" &&
            signal.sdp.type === "offer"
          ) {
            console.log("Ignoring conflicting offer");
            return;
          }

          await pc.setRemoteDescription(
            new RTCSessionDescription(signal.sdp)
          );
          
          if (signal.sdp.type === "offer") {
            // New stream offer received, answer immediately
            // Add local stream tracks if available
            if (localStreamRef.current) {
              localStreamRef.current.getTracks().forEach((track) => {
                const senders = pc.getSenders();
                const alreadyAdded = senders.some((s) => s.track?.id === track.id);
                if (!alreadyAdded) {
                  pc.addTrack(track, localStreamRef.current!);
                }
              });
            }
            if (localScreenStreamRef.current) {
              localScreenStreamRef.current.getTracks().forEach((track) => {
                const senders = pc.getSenders();
                const alreadyAdded = senders.some((s) => s.track?.id === track.id);
                if (!alreadyAdded) {
                  pc.addTrack(track, localScreenStreamRef.current!);
                }
              });
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("signal", {
              to: from,
              signal: { sdp: pc.localDescription },
              type: "media",
            });
          }
        } else if (signal.candidate) {
          const candStr = (signal.candidate.candidate || "").toLowerCase();
          // Filter out link-local IPv6 (fe80::) or non-routable interfaces which introduce 5-10 second ICE validation timeouts
          const isSlowIP = candStr.includes("fe80:") || (candStr.includes(":") && candStr.includes("typ srflx"));
          if (!isSlowIP) {
            // Prioritize adding host/relay candidates immediately
            const isPriority = candStr.includes("typ host") || candStr.includes("typ relay");
            if (isPriority) {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
              // Add other candidates cleanly
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
          } else {
            console.log("[ICE] Filtered out unroutable/slow candidate to accelerate media stream launch:", candStr);
          }
        }
      } catch (err) {
        console.warn("Error processing WebRTC signaling metadata", err);
      }
    };

    // Fired from server when user exits
    const handleUserDisconnected = ({ userId }: { userId: string }) => {
      closePeer(userId);
    };

    // Fired from server when a peer is joined and wants media
    const handleUserConnected = ({ userId, member }: { userId: string; member: any }) => {
      // Re-trigger handshakes if we are already streaming camera or screen
      if (cameraOn || micOn || isSharingScreen) {
        initiateWebRTCCall(userId, member.name);
      }
    };

    // When peer stream states shift
    const handlePeerStreamUpdated = ({ userId, cameraOn, micOn, isSharingScreen }: any) => {
      // If we aren't connected to this user and they turned on their stream, call them!
      if ((cameraOn || micOn || isSharingScreen) && !peersRef.current.has(userId)) {
        const peerMem = members.find((m) => m.id === userId);
        initiateWebRTCCall(userId, peerMem?.name || "Peers");
      }
    };

    socket.on("signal", handleSignal);
    socket.on("user-connected", handleUserConnected);
    socket.on("user-disconnected", handleUserDisconnected);
    socket.on("peer-stream-updated", handlePeerStreamUpdated);

    return () => {
      socket.off("signal", handleSignal);
      socket.off("user-connected", handleUserConnected);
      socket.off("user-disconnected", handleUserDisconnected);
      socket.off("peer-stream-updated", handlePeerStreamUpdated);
    };
  }, [socket, cameraOn, micOn, isSharingScreen, members]);

  // Safe peer creation loop
  const createPeerConnection = (peerSocketId: string, peerName: string): PeerConnectionData => {
    const pc = new RTCPeerConnection(iceConfiguration);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        const candStr = (event.candidate.candidate || "").toLowerCase();
        // Prevent transmission of non-routable link-local IPv6 or duplicate STUN reflexive candidates
        const isSlowIP = candStr.includes("fe80:") || (candStr.includes(":") && candStr.includes("typ srflx"));
        if (!isSlowIP) {
          socket.emit("signal", {
            to: peerSocketId,
            signal: { candidate: event.candidate },
            type: "media",
          });
        }
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteStream) {
        // Look up member to classify if this is screen stream or camera stream
        const member = members.find((m) => m.id === peerSocketId);
        const isScreenStream = member && member.screenStreamId && remoteStream.id === member.screenStreamId;
        const targetId = isScreenStream ? `${peerSocketId}-screen` : peerSocketId;
        const targetName = isScreenStream ? `${peerName} (Screen)` : peerName;

        setRemoteStreams((prev) => {
          const index = prev.findIndex((s) => s.socketId === targetId);
          let newStreams;
          if (index >= 0) {
            const copy = [...prev];
            copy[index] = { socketId: targetId, name: targetName, stream: remoteStream };
            newStreams = copy;
          } else {
            newStreams = [...prev, { socketId: targetId, name: targetName, stream: remoteStream }];
          }
          (window as any)._remoteStreams = newStreams;
          return newStreams;
        });

        // Initialize active speaker check on audio track
        if (!isScreenStream) {
          const audioTracks = remoteStream.getAudioTracks();
          if (audioTracks.length > 0) {
            monitorAudioVolume(remoteStream, peerSocketId);
          }
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        closePeer(peerSocketId);
      }
    };

    const peerData = { pc, socketId: peerSocketId };
    peersRef.current.set(peerSocketId, peerData);
    return peerData;
  };

  // Kickstart P2P Handshake as an Initiator (Producer -> Spectator)
  const initiateWebRTCCall = async (peerSocketId: string, peerName: string) => {
    try {
      const { pc } = createPeerConnection(peerSocketId, peerName);

      // Attach our camera/voice streams if actively sharing
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localScreenStreamRef.current!);
        });
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await pc.setLocalDescription(offer);

      socket.emit("signal", {
        to: peerSocketId,
        signal: { sdp: pc.localDescription },
        type: "media",
        fromSenderName: members.find((m) => m.id === myId)?.name || "Host",
      });
    } catch (e) {
      console.warn("Failed initiating WebRTC mesh call to peer index", peerSocketId, e);
    }
  };

  // Trigger Local Camera & Microphone captures
  const startCameraMic = async (wantCam: boolean, wantMic: boolean) => {
    try {
      if (!wantCam && !wantMic) {
        stopLocalStream();
        return;
      }

      // Check current active tracks to avoid re-initializing hardware if already running
      let currentVideoTrack = localStreamRef.current?.getVideoTracks()[0];
      let currentAudioTrack = localStreamRef.current?.getAudioTracks()[0];

      let needsNewStream = false;
      if (wantCam && !currentVideoTrack) needsNewStream = true;
      if (wantMic && !currentAudioTrack) needsNewStream = true;

      let newStream: MediaStream | null = null;
      if (needsNewStream) {
        // Request missing devices on-demand from user's media context
        newStream = await navigator.mediaDevices.getUserMedia({
          video: (wantCam && !currentVideoTrack) ? { width: 320, height: 240, frameRate: 15 } : false,
          audio: (wantMic && !currentAudioTrack) ? true : false,
        });
      }

      // Merge new tracks into existing local stream smoothly
      const mergedStream = localStreamRef.current || new MediaStream();
      
      if (newStream) {
        newStream.getTracks().forEach((track) => {
          mergedStream.addTrack(track);
        });
      }

      // Toggle enabled state of each track to keep hardware and P2P connection active but silent/dark
      mergedStream.getVideoTracks().forEach((track) => {
        track.enabled = wantCam;
        if (!wantCam) {
          track.stop();
          mergedStream.removeTrack(track);
        }
      });

      mergedStream.getAudioTracks().forEach((track) => {
        track.enabled = wantMic;
        if (!wantMic) {
          track.stop();
          mergedStream.removeTrack(track);
        }
      });

      localStreamRef.current = mergedStream;
      setLocalStream(new MediaStream(mergedStream.getTracks()));

      // Update local preview instantly without lag
      if (localVideoRef.current && wantCam) {
        localVideoRef.current.srcObject = mergedStream;
      }

      // Sync and hot-swap tracks on peer connections using robust replaceTrack or targeted add/remove loops
      peersRef.current.forEach(({ pc, socketId }) => {
        const activeTracks = mergedStream.getTracks();
        const senders = pc.getSenders();

        // 1. Remove track senders that are no longer active to avoid peer stream corruption
        senders.forEach((sender) => {
          if (sender.track && !activeTracks.some((t) => t.id === sender.track?.id)) {
            try {
              pc.removeTrack(sender);
            } catch (err) {
              console.warn("Could not remove unused WebRTC track sender", err);
            }
          }
        });

        // 2. Add or dynamically replace track streams on existing active channels
        activeTracks.forEach((track) => {
          const existingSender = pc.getSenders().find((s) => s.track && s.track.kind === track.kind);
          if (existingSender) {
            if (existingSender.track?.id !== track.id) {
              existingSender.replaceTrack(track).catch((err) => {
                console.warn("Error live-swapping sender track content", err);
              });
            }
          } else {
            pc.addTrack(track, mergedStream);
          }
        });

        // 3. Negotiate connection updates cleanly with the targeted peer
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit("signal", {
              to: socketId,
              signal: { sdp: pc.localDescription },
              type: "media",
              fromSenderName: members.find((m) => m.id === myId)?.name || "Host",
            });
          })
          .catch(() => {});
      });

      if (wantMic) {
        monitorAudioVolume(mergedStream, "me");
      } else {
        if (audioContextsRef.current.has("me")) {
          const meter = audioContextsRef.current.get("me")!;
          clearInterval(meter.interval);
          audioContextsRef.current.delete("me");
          setActiveSpeakers((prev) => {
            const copy = { ...prev };
            delete copy["me"];
            return copy;
          });
        }
      }

    } catch (err) {
      console.warn("Input permission denied or hardware devices occupied", err);
      setCameraOn(false);
      setMicOn(false);
    }
  };

  // Start Screen Sharing to deliver visual streams to spectators
  const startScreenShare = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 15, max: 20 }
      },
      audio: true
    });

      localScreenStreamRef.current = screenStream;
      setIsSharingScreen(true);

      const myName = members.find((m) => m.id === myId)?.name || "Host";
      onScreenShareStream(screenStream, myName);

      // Add screen tracks to all peer connections
      peersRef.current.forEach(({ pc, socketId }) => {
        screenStream.getTracks().forEach((track) => {
          const alreadyExists = pc
            .getSenders()
            .some((s) => s.track?.id === track.id);
            
          if (!alreadyExists) {
            pc.addTrack(track, screenStream);
          }
        });

        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit("signal", {
              to: socketId,
              signal: { sdp: pc.localDescription },
              type: "media",
              fromSenderName: myName,
            });
          })
          .catch((err) => {
            console.warn("Failed negotiating screen share offer", err);
          });
      });

      // If screen share is manually stopped on OS UI level, shut it down nicely
      screenStream.getVideoTracks()[0].onended = () => {
        stopLocalScreenShare();
      };
    } catch (e) {
      console.warn("Screen share permission dismissed", e);
      setIsSharingScreen(false);
    }
  };

  const stopLocalScreenShare = () => {
    if (localScreenStreamRef.current) {
      const tracks = localScreenStreamRef.current.getTracks();
      tracks.forEach((track) => track.stop());

      // Remove screen tracks from all peer connections
      peersRef.current.forEach(({ pc, socketId }) => {
        const senders = pc.getSenders();
        senders.forEach((sender) => {
          if (sender.track && tracks.some((t) => t.id === sender.track?.id)) {
            try {
              pc.removeTrack(sender);
            } catch (e) {
              // ignore
            }
          }
        });

        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit("signal", {
              to: socketId,
              signal: { sdp: pc.localDescription },
              type: "media",
              fromSenderName: members.find((m) => m.id === myId)?.name || "Host",
            });
          })
          .catch(() => {});
      });

      localScreenStreamRef.current = null;
    }
    setIsSharingScreen(false);
    onScreenShareStream(null, "");
  };

  const stopLocalStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);

    // Revoke tracks from every open active peer connection to clean up state
    peersRef.current.forEach(({ pc, socketId }) => {
      pc.getSenders().forEach((sender) => {
        try {
          pc.removeTrack(sender);
        } catch (e) {
          // ignore
        }
      });
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit("signal", {
            to: socketId,
            signal: { sdp: pc.localDescription },
            type: "media",
            fromSenderName: members.find((m) => m.id === myId)?.name || "Host",
          });
        })
        .catch(() => {});
    });

    if (audioContextsRef.current.has("me")) {
      const meter = audioContextsRef.current.get("me")!;
      clearInterval(meter.interval);
      audioContextsRef.current.delete("me");
      setActiveSpeakers((prev) => {
        const copy = { ...prev };
        delete copy["me"];
        return copy;
      });
    }
  };

  // Measure audio levels to dynamically highlight who is speaking
  const monitorAudioVolume = (stream: MediaStream, userIdStr: string) => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      const audioContext = new AudioCtxClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const isSpeaking = average > 18; // Decibel activity threshold

        setActiveSpeakers((prev) => {
          if (prev[userIdStr] === isSpeaking) return prev;
          return { ...prev, [userIdStr]: isSpeaking };
        });
      }, 250);

      audioContextsRef.current.set(userIdStr, { interval, node: analyser });
    } catch (e) {
      console.warn("Active speaker audio context initialize error", e);
    }
  };

  const closePeer = (socketId: string) => {
    const peerData = peersRef.current.get(socketId);
    if (peerData) {
      peerData.pc.close();
      peersRef.current.delete(socketId);
    }
    
    setRemoteStreams((prev) => {
      const filtered = prev.filter((s) => s.socketId !== socketId && s.socketId !== `${socketId}-screen`);
      (window as any)._remoteStreams = filtered;
      return filtered;
    });
    
    if (audioContextsRef.current.has(socketId)) {
      clearInterval(audioContextsRef.current.get(socketId)!.interval);
      audioContextsRef.current.delete(socketId);
    }
    
    setActiveSpeakers((prev) => {
      const copy = { ...prev };
      delete copy[socketId];
      return copy;
    });
  };

  const closeAllPeers = () => {
    peersRef.current.forEach(({ pc }) => pc.close());
    peersRef.current.clear();
    setRemoteStreams([]);
    (window as any)._remoteStreams = [];
  };

  return (
    <div className="bg-white/[0.01] backdrop-blur-3xl rounded-2xl border border-white/5 p-4 space-y-4 shadow-2xl" id="webrtc-container">
      {/* Action Controller Grid */}
      <div className="flex flex-col gap-3">
        <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-1.5 font-sans">
          <Users className="w-3.5 h-3.5 text-purple-400" />
          <span>Real-time Stream Gears</span>
        </h3>

        <div className="grid grid-cols-2 gap-2">
          {/* Camera Button */}
          <button
            onClick={() => {
              const toggled = !cameraOn;
              setCameraOn(toggled);
              startCameraMic(toggled, micOn);
            }}
            className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold transition-all border outline-none cursor-pointer ${
              cameraOn
                ? "bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30"
                : "bg-white/5 text-white/50 border-white/10 hover:text-white hover:bg-white/10"
            }`}
            id="btn-toggle-cam"
          >
            {cameraOn ? (
              <>
                <Camera className="w-4 h-4 text-purple-400 animate-pulse" />
                <span>On Cam</span>
              </>
            ) : (
              <>
                <CameraOff className="w-4 h-4 text-white/30" />
                <span>Cam Off</span>
              </>
            )}
          </button>

          {/* Microphone Button */}
          <button
            onClick={() => {
              const toggled = !micOn;
              setMicOn(toggled);
              startCameraMic(cameraOn, toggled);
            }}
            className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold transition-all border outline-none cursor-pointer ${
              micOn
                ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30"
                : "bg-white/5 text-white/50 border-white/10 hover:text-white hover:bg-white/10"
            }`}
            id="btn-toggle-mic"
          >
            {micOn ? (
              <>
                <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>Voice Live</span>
              </>
            ) : (
              <>
                <MicOff className="w-4 h-4 text-white/30" />
                <span>Muted</span>
              </>
            )}
          </button>
        </div>

        {/* Screen sharing controller */}
        <button
          onClick={isSharingScreen ? stopLocalScreenShare : startScreenShare}
          className={`w-full flex items-center justify-center gap-2 py-3 border rounded-xl text-xs font-bold outline-none cursor-pointer transition-all ${
            isSharingScreen
              ? "bg-gradient-to-r from-pink-600 to-rose-600 border-pink-500 hover:opacity-90 text-white shadow-[0_0_15px_rgba(236,72,153,0.4)] animate-pulse"
              : "bg-white/5 text-white border-white/10 hover:bg-white/10 hover:text-white"
          }`}
          id="btn-screeshare"
        >
          {isSharingScreen ? (
            <>
              <MonitorOff className="w-4 h-4 shrink-0" />
              <span>Stop Share Screen</span>
            </>
          ) : (
            <>
              <Monitor className="w-4 h-4 shrink-0" />
              <span>Share My Screen</span>
            </>
          )}
        </button>
      </div>

      {/* Screen / Video Grids rendering cameras */}
      {(cameraOn || remoteStreams.filter((s) => !s.socketId.endsWith("-screen")).length > 0) && (
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-1 font-sans">
            <Video className="w-3.5 h-3.5 text-purple-400" />
            <span>Active Webcams</span>
          </p>

          <div className="grid grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto p-1 scrollbar-none">
            {/* Local Preview Card */}
            {cameraOn && (
              <div
                className={`relative bg-[#050505] rounded-xl overflow-hidden aspect-video border transition-all duration-300 ${
                  activeSpeakers["me"] ? "border-emerald-500 ring-1 ring-emerald-500/30" : "border-white/10"
                }`}
                id="webcam-local"
              >
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover -scale-x-100"
                />
                
                <div className="absolute inset-x-0 bottom-0 py-1.5 px-2.5 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-[10px] text-white/80">
                  <span className="font-semibold truncate">You</span>
                  {activeSpeakers["me"] && <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </div>
              </div>
            )}

            {/* Remote Streams Cards */}
            {remoteStreams
              .filter((s) => !s.socketId.endsWith("-screen"))
              .map(({ socketId, name, stream }) => {
                const isSpeaking = activeSpeakers[socketId];
                return (
                  <div
                    key={socketId}
                    className={`relative bg-[#050505] rounded-xl overflow-hidden aspect-video border transition-all duration-300 ${
                      isSpeaking ? "border-emerald-500 ring-1 ring-emerald-500/30" : "border-white/10"
                    }`}
                    id={`webcam-${socketId}`}
                  >
                    <video
                      ref={(el) => {
                        if (el && el.srcObject !== stream) {
                          el.srcObject = stream;
                        }
                      }}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    
                    <div className="absolute inset-x-0 bottom-0 py-1.5 px-2.5 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-[10px] text-white/80">
                      <span className="font-semibold truncate">{name}</span>
                      {isSpeaking && <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
