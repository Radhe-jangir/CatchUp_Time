import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import WelcomeScreen from "./components/WelcomeScreen";
import MediaPlayer from "./components/MediaPlayer";
import WebRTCPanel from "./components/WebRTCPanel";
import ChatPanel from "./components/ChatPanel";
import MembersPanel from "./components/MembersPanel";
import { RoomState, Member, Message, PlayerState } from "./types";
import { Film, LogOut, Lock, Unlock, Crown, Monitor, Columns, Tv, Smile, Send } from "lucide-react";

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState("");

  // Room states from backend
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>({
    playing: false,
    currentTime: 0,
    playbackRate: 1.0,
    mediaUrl: "",
    mediaType: "none",
    hostTimeUpdated: Date.now(),
  });

  // Client Screenshare States
  const [localScreenShare, setLocalScreenShare] = useState<MediaStream | null>(null);
  const [activeScreenSharer, setActiveScreenSharer] = useState<string | null>(null);

  // Layout states (Theater vs Normal Grid)
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<"gears" | "audience" | "chat">("chat"); // default to chat tab first on mobile

  // Mobile fixed Chat states
  const [mobileText, setMobileText] = useState("");
  const [showMobileEmoji, setShowMobileEmoji] = useState(false);
  const mobileEmojiRef = useRef<HTMLDivElement>(null);

  // Real-time ping state
  const [currentPing, setCurrentPing] = useState<number | null>(null);

  useEffect(() => {
    if (!socket) {
      setCurrentPing(null);
      return;
    }

    const handlePong = (timestamp: number) => {
      const latency = Date.now() - timestamp;
      setCurrentPing(latency);
    };

    socket.on("pong-test", handlePong);

    // Initial check and periodic checks every 3 seconds
    socket.emit("ping-test", Date.now());
    const intervalId = setInterval(() => {
      socket.emit("ping-test", Date.now());
    }, 3000);

    return () => {
      socket.off("pong-test", handlePong);
      clearInterval(intervalId);
    };
  }, [socket]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (mobileEmojiRef.current && !mobileEmojiRef.current.contains(e.target as Node)) {
        setShowMobileEmoji(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024); // lg breakpoint is 1024px
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Parse invite Room ID from URL query parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room") || params.get("Room");
    if (roomParam) {
      setRoomId(roomParam.toUpperCase());
    }
  }, []);

  const handleJoin = (name: string, pfp: string, rId: string) => {
    setUserName(name);
    setAvatar(pfp);
    setRoomId(rId);

    // Initialize Socket connection
    // Production & Development both share the Express port, so connect to window.location.origin
    const socketInstance = io(window.location.origin, {
      transports: ["websocket"],
      reconnectionAttempts: 8,
      reconnectionDelay: 2000,
    });

    setSocket(socketInstance);

    socketInstance.emit("join-room", {
      roomId: rId,
      userName: name,
      avatar: pfp,
    });

    socketInstance.on("sync-init-state", ({ roomState: initialRoom, yourId }: { roomState: RoomState; yourId: string }) => {
      setMyId(yourId);
      setRoomState(initialRoom);
      setPlayerState(initialRoom.playerState);
    });

    socketInstance.on("room-updated", (updatedRoom: RoomState) => {
      setRoomState(updatedRoom);
      setPlayerState(updatedRoom.playerState);
      
      // Update screen sharer info
      const sharer = updatedRoom.members.find((m) => m.isSharingScreen);
      if (sharer) {
        setActiveScreenSharer(sharer.name);
      } else {
        setActiveScreenSharer(null);
      }
    });

    socketInstance.on("playback-synced", (newPlayerState: PlayerState) => {
      setPlayerState(newPlayerState);
    });

    socketInstance.on("message-received", (newMessage: Message) => {
      setRoomState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, newMessage],
        };
      });
    });

    // Clean URL query parameters to cleanly display roomId
    if (window.history.pushState) {
      const newurl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${rId}`;
      window.history.pushState({ path: newurl }, "", newurl);
    }
  };

  const handleSendMessage = (text: string) => {
    if (socket) {
      socket.emit("send-message", text);
    }
  };

  const handleSyncPlayback = (newPlayerState: PlayerState) => {
    setPlayerState(newPlayerState);
    if (socket) {
      socket.emit("sync-playback", newPlayerState);
    }
  };

  const handleToggleControlMode = () => {
    if (socket && roomState) {
      const isMeHost = roomState.members.find((m) => m.id === myId)?.isHost;
      if (isMeHost) {
        socket.emit("toggle-control-mode", {
          isPublicControl: !roomState.isPublicControl,
        });
      }
    }
  };

  const handleTransferHost = (memberId: string) => {
    if (socket) {
      socket.emit("transfer-host", memberId);
    }
  };

  const handleLeaveRoom = () => {
    if (socket) {
      socket.emit("leave-room");
      socket.disconnect();
    }
    setSocket(null);
    setRoomState(null);
    setRoomId(null);
    setLocalScreenShare(null);
    setActiveScreenSharer(null);
    setIsTheaterMode(false);

    // Wipe room search param cleanly
    if (window.history.pushState) {
      const emptyUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
      window.history.pushState({ path: emptyUrl }, "", emptyUrl);
    }
  };

  // Callback to display shared screens inside big theater stage
  const handleScreenShareStream = (stream: MediaStream | null, sharerNameStr: string) => {
    setLocalScreenShare(stream);
    if (stream) {
      setActiveScreenSharer(sharerNameStr);
    } else {
      setActiveScreenSharer(null);
    }
  };

  if (!roomState || !roomId) {
    return <WelcomeScreen onJoin={handleJoin} initialRoomId={roomId || ""} />;
  }

  const myMember = roomState.members.find((m) => m.id === myId);
  const isMeHost = myMember?.isHost || false;

  return (
    <div className="min-h-screen bg-[#050505] font-sans text-[#f8fafc] flex flex-col selection:bg-purple-500/30 overflow-x-hidden relative">
      {/* Premium Frosted Ambient Background Glows */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-purple-900/[0.04] rounded-full blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-pink-500/[0.04] rounded-full blur-[140px]" />
      </div>

      {/* Navigation Top Header - hidden on mobile so that fixed video player is cleanly pinned to top-0 without overlapping */}
      <header className="hidden lg:flex lg:sticky lg:top-0 bg-[#0a0a0a]/60 backdrop-blur-xl border-b border-white/5 px-3 py-3 sm:px-6 sm:py-4 z-40 items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="p-1.5 sm:p-2 bg-white/5 rounded-xl border border-white/10 text-purple-400">
            <Film className="w-4 h-4 sm:w-5 sm:h-5 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          </div>
          <div>
            <h1 className="text-sm sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-white via-purple-300 to-pink-300 bg-clip-text text-transparent">
              Movie<span className="text-purple-400 font-extrabold">Dekhe</span>
            </h1>
            <span className="hidden sm:block text-[8px] text-white/30 font-mono tracking-widest uppercase font-bold">Party Theater</span>
          </div>
        </div>

        {/* Real-time Connection Status Indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 hover:border-white/10 rounded-xl transition duration-200" id="connection-status-badge">
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              currentPing === null ? "bg-rose-500" :
              currentPing < 75 ? "bg-emerald-400" :
              currentPing < 180 ? "bg-amber-400" : "bg-rose-400"
            }`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${
              currentPing === null ? "bg-rose-500" :
              currentPing < 75 ? "bg-emerald-500" :
              currentPing < 180 ? "bg-amber-500" : "bg-rose-500"
            }`} />
          </span>
          <span className="text-[10px] text-zinc-400 font-semibold tracking-wider uppercase font-mono">Ping:</span>
          <span className={`font-mono text-xs font-bold ${
            currentPing === null ? "text-rose-400 animate-pulse" :
            currentPing < 75 ? "text-emerald-400" :
            currentPing < 180 ? "text-amber-400" : "text-rose-400"
          }`}>
            {currentPing === null ? "Connecting..." : `${currentPing} ms`}
          </span>
        </div>

        {/* Room Sync and Control toggles */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0" id="header-center-controls">
          {/* Host lock button */}
          {isMeHost ? (
            <button
              onClick={handleToggleControlMode}
              className={`flex items-center gap-1 sm:gap-2 px-2 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[10px] sm:text-xs font-bold border transition outline-none cursor-pointer ${
                roomState.isPublicControl
                  ? "bg-purple-950/20 border-purple-500/20 text-purple-400 hover:bg-purple-950/45"
                  : "bg-red-950/20 border-red-500/20 text-red-400 hover:bg-red-950/45"
              }`}
              title={isMeHost ? "Toggle playback lockdowns" : "Host has locked controls"}
            >
              {roomState.isPublicControl ? (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Unlocked Party</span>
                  <span className="sm:hidden">Unlocked</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Host Controls Only</span>
                  <span className="sm:hidden">Locked</span>
                </>
              )}
            </button>
          ) : (
            <div
              className={`flex items-center gap-1 sm:gap-2 px-2 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[10px] sm:text-xs font-semibold border ${
                roomState.isPublicControl
                  ? "bg-purple-950/10 border-purple-500/10 text-purple-400/80"
                  : "bg-red-950/10 border-red-500/10 text-red-400/80"
              }`}
            >
              {roomState.isPublicControl ? (
                <Unlock className="w-3.5 h-3.5" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{roomState.isPublicControl ? "Unlocked Party" : "Locked Playback"}</span>
              <span className="sm:hidden">{roomState.isPublicControl ? "Unlocked" : "Locked"}</span>
            </div>
          )}

          {/* Active host representation */}
          <div className="hidden md:flex items-center gap-2 px-3.5 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white/80">
            <Crown className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
            <span className="font-semibold">Host:</span>
            <span className="text-purple-400 font-bold max-w-[80px] truncate">
              {roomState.members.find((m) => m.isHost)?.name || "Undecided"}
            </span>
          </div>

          {/* Theater mode layout switch */}
          <button
            onClick={() => setIsTheaterMode((prev) => !prev)}
            className={`p-1.5 sm:p-2 rounded-xl border transition cursor-pointer ${
              isTheaterMode 
                ? "bg-purple-600/20 border-purple-500 text-purple-400" 
                : "bg-white/5 border-white/10 text-white/60 hover:text-white"
            }`}
            title="Toggle Theater Mode"
          >
            {isTheaterMode ? <Columns className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Tv className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>

          {/* Exit / Disconnect button */}
          <button
            onClick={handleLeaveRoom}
            className="flex items-center gap-1 sm:gap-2 px-2 py-1.5 sm:px-3.5 sm:py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl text-[10px] sm:text-xs font-bold active:scale-95 transition cursor-pointer"
            id="btn-leave"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Leave Party</span>
            <span className="sm:hidden">Leave</span>
          </button>
        </div>
      </header>

      {/* Main Watch Layout Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-0 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 pb-20 sm:pb-6 pt-[56.25vw] lg:pt-0">
        
        {/* Playback Stage Column */}
        <section
          className={`space-y-4 lg:space-y-6 ${
            isTheaterMode ? "lg:col-span-12" : "lg:col-span-8"
          } transition-all duration-300`}
          id="main-stage-container"
        >
          {/* Fixed Player in upper section on mobile, interactive scrolling and navigating below */}
          {activeScreenSharer ? (
            <div className="fixed top-0 left-0 right-0 z-50 aspect-video bg-[#050505] border-b border-white/10 flex flex-col group shadow-[0_4px_30px_rgba(0,0,0,0.6)] lg:relative lg:top-auto lg:z-30 lg:bg-transparent lg:rounded-3xl lg:overflow-hidden lg:border lg:border-purple-500/30 lg:shadow-xl lg:shadow-purple-500/5 animate-fade-in">
              {/* Display remote / local Screen Share Track */}
              <video
                ref={(el) => {
                  if (el) {
                    if (localScreenShare) {
                      if (el.srcObject !== localScreenShare) {
                        el.srcObject = localScreenShare;
                      }
                    } else {
                      // Grab remote screensharing stream from our remoteStreams
                      const screenStreamObj = roomState.members.find((m) => m.isSharingScreen);
                      if (screenStreamObj) {
                        // Locate active HTML Video streams attached to this member in WebRTC Panel
                        const rStream = (window as any)._remoteStreams?.find(
                          (s: any) => s.socketId === screenStreamObj.id || s.socketId === `${screenStreamObj.id}-screen`
                        )?.stream;
                        if (rStream && el.srcObject !== rStream) {
                          el.srcObject = rStream;
                        }
                      }
                    }
                  }
                }}
                autoPlay
                playsInline
                controls
                className="w-full h-full object-contain bg-[#050505]"
              />
              
              {/* Top Details Panel overlay */}
              <div className="absolute top-4 left-4 right-4 bg-[#050505]/95 border border-white/10 backdrop-blur-md px-4 py-3 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-purple-400 animate-pulse" />
                  <span className="font-bold text-white">Live Screen Sharing Area</span>
                  <span className="text-white/30">•</span>
                  <span className="text-white/60">Streamed by <span className="text-pink-400 font-bold">{activeScreenSharer}</span></span>
                </div>
                {localScreenShare && (
                  <button
                    onClick={() => handleScreenShareStream(null, "")}
                    className="px-3 py-1 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 rounded-lg font-bold transition cursor-pointer"
                  >
                    Disconnect Share
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Classic Media Player Stage */
            <MediaPlayer
              playerState={playerState}
              members={roomState.members}
              myId={myId}
              isPublicControl={roomState.isPublicControl}
              onSyncPlayback={handleSyncPlayback}
            />
          )}

          {/* On mobile devices, render a beautiful scrollable detail and feature panel beneath the fixed video */}
          {!isTheaterMode && isMobile && (
            <div className="flex flex-col min-h-0 divide-y divide-white/5">
              {/* Youtube-like Info Ribbon right under player */}
              <div className="px-4 py-3 bg-[#0d0d10] flex items-center justify-between text-xs gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white truncate">MovieDekhe Room</h2>
                  <p className="text-[10px] text-white/40 flex items-center gap-1 mt-0.5">
                    <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    <span>{roomState.members.length} watching</span>
                    <span>•</span>
                    <span className="text-purple-400 font-semibold truncate">Host: {roomState.members.find(m => m.isHost)?.name || "Host"}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[10px] text-zinc-400">
                    {roomState.isPublicControl ? "Free Play" : "Host Locked"}
                  </div>
                  <button
                    onClick={handleLeaveRoom}
                    className="p-2 bg-red-500/10 hover:bg-red-500/20 active:scale-95 border border-red-500/30 text-red-400 rounded-xl font-bold flex items-center justify-center cursor-pointer"
                    title="Leave Room"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Dynamic segmented switcher under the ribbon */}
              <div className="px-4 py-2 bg-[#09090b] border-y border-white/5 flex gap-2 overflow-x-auto scrollbar-none">
                <button
                  type="button"
                  onClick={() => setActiveMobileTab("chat")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                    activeMobileTab === "chat" 
                      ? "bg-purple-600 text-white shadow-md shadow-purple-500/20" 
                      : "bg-white/5 border border-white/5 text-zinc-400 hover:text-white"
                  }`}
                >
                  <span>Chat</span>
                  <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-white/60">
                    {roomState.messages.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMobileTab("gears")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                    activeMobileTab === "gears" 
                      ? "bg-purple-600 text-white shadow-md shadow-purple-500/20" 
                      : "bg-white/5 border border-white/5 text-zinc-400 hover:text-white"
                  }`}
                >
                  <span>Cams & Gears</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMobileTab("audience")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                    activeMobileTab === "audience" 
                      ? "bg-purple-600 text-white shadow-md shadow-purple-500/20" 
                      : "bg-white/5 border border-white/5 text-zinc-400 hover:text-white"
                  }`}
                >
                  <span>Audience</span>
                  <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-white/60">
                    {roomState.members.length}
                  </span>
                </button>
              </div>

              {/* Dynamic scrollable elements in between according to active tab */}
              <div className="p-4 pb-24 transition-all duration-300">
                {activeMobileTab === "gears" && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-zinc-500 tracking-wider uppercase">Cams & Media Streams</h3>
                    <WebRTCPanel
                      socket={socket}
                      members={roomState.members}
                      myId={myId}
                      roomId={roomId}
                      onScreenShareStream={handleScreenShareStream}
                    />
                  </div>
                )}
                {activeMobileTab === "audience" && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-zinc-500 tracking-wider uppercase">Watching Audience</h3>
                    <MembersPanel
                      members={roomState.members}
                      myId={myId}
                      roomId={roomId}
                      onTransferHost={handleTransferHost}
                    />
                  </div>
                )}
                {activeMobileTab === "chat" && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-zinc-500 tracking-wider uppercase">Live Group Chat</h3>
                    <div className="h-[360px] bg-white/[0.01] rounded-2xl border border-white/5 overflow-hidden shadow-inner">
                      <ChatPanel
                        messages={roomState.messages}
                        myId={myId}
                        onSendMessage={handleSendMessage}
                        hideInput={true}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Render WebRTC panel under player in Theater Mode */}
          {isTheaterMode && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-1">
                <WebRTCPanel
                  socket={socket}
                  members={roomState.members}
                  myId={myId}
                  roomId={roomId}
                  onScreenShareStream={handleScreenShareStream}
                />
              </div>
              <div className="md:col-span-1">
                <MembersPanel
                  members={roomState.members}
                  myId={myId}
                  roomId={roomId}
                  onTransferHost={handleTransferHost}
                />
              </div>
              <div className="md:col-span-1 h-[320px]">
                <ChatPanel
                  messages={roomState.messages}
                  myId={myId}
                  onSendMessage={handleSendMessage}
                />
              </div>
            </div>
          )}
        </section>

        {/* Sidebar Dashboard Controls (Hidden or re-arranged during Theater Mode) */}
        {!isTheaterMode && (
          <aside className="lg:col-span-4 space-y-6 flex flex-col h-full lg:max-h-[calc(100vh-130px)]">
            
            {/* Mesh Audio Video grids - only rendered here on desktop layout so exactly one instance of WebRTC Panel mounts */}
            {!isMobile && (
              <WebRTCPanel
                socket={socket}
                members={roomState.members}
                myId={myId}
                roomId={roomId}
                onScreenShareStream={handleScreenShareStream}
              />
            )}

          </aside>
        )}

      </main>

      {/* Youtube style mobile bottom fixed chat input */}
      {isMobile && !isTheaterMode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#080808]/95 backdrop-blur-md border-t border-white/10 px-4 py-2 h-16 flex items-center shadow-[0_-8px_24px_rgba(0,0,0,0.8)]">
          {/* Mobile emoji drawer */}
          {showMobileEmoji && (
            <div
              ref={mobileEmojiRef}
              className="absolute bottom-18 left-4 right-4 p-2 bg-[#0d0d10]/95 backdrop-blur-3xl border border-white/10 rounded-xl grid grid-cols-6 gap-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.9)] z-50"
            >
              {["😀", "😂", "🔥", "🎉", "🍿", "🎬", "😍", "😱", "👍", "👏", "😮", "😴"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setMobileText((prev) => prev + emoji)}
                  className="w-10 h-10 text-xl flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors duration-150 cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mobileText.trim()) {
                handleSendMessage(mobileText.trim());
                setMobileText("");
                setShowMobileEmoji(false);
              }
            }}
            className="w-full flex items-center gap-2 bg-white/5 border border-white/10 focus-within:border-purple-500/50 rounded-xl overflow-hidden px-2 transition-all duration-200"
          >
            <button
              type="button"
              onClick={() => setShowMobileEmoji((prev) => !prev)}
              className={`p-2 text-white/40 hover:text-purple-400 transition-colors focus:outline-none cursor-pointer ${
                showMobileEmoji ? "text-purple-400" : ""
              }`}
            >
              <Smile className="w-5 h-5 stroke-[1.8]" />
            </button>
            <input
              type="text"
              placeholder="Type your message..."
              value={mobileText}
              onChange={(e) => setMobileText(e.target.value)}
              className="flex-1 bg-transparent py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none min-w-0"
              maxLength={180}
            />
            <button
              type="submit"
              disabled={!mobileText.trim()}
              className="p-2 text-purple-400 disabled:text-white/20 hover:text-purple-300 transition-colors focus:outline-none cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4 stroke-[2]" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
