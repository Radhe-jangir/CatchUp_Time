import React, { useState, useEffect, useRef } from "react";
import Hls from "hls.js";
import { PlayerState, Member } from "../types";
import { Play, Pause, RotateCcw, Link, Film, Globe, Monitor, HelpCircle, FastForward } from "lucide-react";

interface MediaPlayerProps {
  playerState: PlayerState;
  members: Member[];
  myId: string;
  isPublicControl: boolean;
  onSyncPlayback: (state: PlayerState) => void;
}

// Built-in public stream test samples
const STREAM_PRESETS = [
  {
    name: "Live HLS Test Stream (.m3u8 HLS)",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  },
];

export default function MediaPlayer({
  playerState,
  members,
  myId,
  isPublicControl,
  onSyncPlayback,
}: MediaPlayerProps) {
  const [inputUrl, setInputUrl] = useState("");
  const [isUrlChecking, setIsUrlChecking] = useState(false);
  const [embedWarning, setEmbedWarning] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const isSyncingRef = useRef<boolean>(false); // Mutex lock to stop feedback loops

  const myMember = members.find((m) => m.id === myId);
  const isHost = myMember?.isHost || false;
  const canSendSync = isPublicControl || isHost;

  // Track state-updates from websocket server
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playerState.mediaType !== "video") return;

    // Direct loop protection
    isSyncingRef.current = true;

    // Sync media source url
    if (video.src !== playerState.mediaUrl && !hlsRef.current) {
      loadVideoSource(playerState.mediaUrl);
    }

    // Sync play/pause state
    if (playerState.playing) {
      if (video.paused) {
        video.play().catch(() => {});
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }

    // Sync speed
    if (video.playbackRate !== playerState.playbackRate) {
      video.playbackRate = playerState.playbackRate;
    }

    // Drift evaluation: calculated as time offset since the sync was broadcasted
    const latencyCorrection = playerState.playing 
      ? (Date.now() - playerState.hostTimeUpdated) / 1000 
      : 0;
    
    // Max 1 sec correction limit
    const expectedTime = playerState.currentTime + Math.min(latencyCorrection, 1.2);
    const drift = Math.abs(video.currentTime - expectedTime);

    if (drift > 1.5) {
      video.currentTime = expectedTime;
    }

    isSyncingRef.current = false;
  }, [playerState]);

  // Handle stream initialization (Normal Files vs HLS channels)
  const loadVideoSource = (url: string) => {
    const video = videoRef.current;
    if (!video) return;

    // Terminate existing Hls.js channels
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (url.endsWith(".m3u8") || url.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (playerState.playing) {
            video.play().catch(() => {});
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native Apple Safari .m3u8 fallback
        video.src = url;
      }
    } else {
      // Normal direct stream support
      video.src = url;
    }
    video.load();
  };

  // Safe handler logic feeding sync socket streams
  const handleLocalPlaybackEvent = (action: "play" | "pause" | "seek" | "rate") => {
    const video = videoRef.current;
    if (!video || !canSendSync) return;

    // Escape if the action is triggered as a result of remote socket synchronization
    if (isSyncingRef.current) return;

    const updatedState: PlayerState = {
      playing: !video.paused,
      currentTime: video.currentTime,
      playbackRate: video.playbackRate,
      mediaUrl: playerState.mediaUrl,
      mediaType: "video",
      hostTimeUpdated: Date.now(),
    };

    onSyncPlayback(updatedState);
  };

  const handlePresettedClick = (url: string) => {
    setInputUrl(url);
    submitMediaChange(url);
  };

  // Parse YouTube url into /embed/ form
  const parseYouTubeId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const getEmbeddableUrl = (url: string): { url: string; type: "video" | "iframe" } => {
    const ytId = parseYouTubeId(url);
    if (ytId) {
      return {
        url: `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&controls=1`,
        type: "iframe",
      };
    }
    
    if (url.includes("vimeo.com")) {
      const vimeoReg = /vimeo\.com\/(?:video\/)?([0-9]+)/;
      const match = url.match(vimeoReg);
      if (match) {
        return {
          url: `https://player.vimeo.com/video/${match[1]}?autoplay=1`,
          type: "iframe",
        };
      }
    }

    // Direct files usually end with or contain specific terms
    const isDirectVideo = url.endsWith(".mp4") || url.endsWith(".webm") || url.endsWith(".ogg") || url.endsWith(".m3u8") || url.includes(".m3u8") || url.includes("/mp4");
    if (isDirectVideo) {
      return { url, type: "video" };
    }

    // Default to frame
    return { url, type: "iframe" };
  };

  const submitMediaChange = async (urlStr: string) => {
    if (!urlStr.trim()) return;
    setEmbedWarning(null);
    setIsUrlChecking(true);

    const { url, type } = getEmbeddableUrl(urlStr.trim());

    if (type === "iframe") {
      // Hit our backend proxy to pre-verify remote iframe embedding block rules
      try {
        const checkRes = await fetch(`/api/check-embed?url=${encodeURIComponent(urlStr.trim())}`);
        const data = await checkRes.json();
        
        if (!data.embeddable) {
          setEmbedWarning(data.message || "This website restricts inline embedding!");
          setIsUrlChecking(false);
          return;
        }
      } catch (err) {
        // Fallback gracefully
        console.warn("Embed pre-checking failed, loading source directly");
      }
    }

    setIsUrlChecking(false);

    // Synchronize Room's Media state
    onSyncPlayback({
      playing: false,
      currentTime: 0,
      playbackRate: 1.0,
      mediaUrl: url,
      mediaType: type,
      hostTimeUpdated: Date.now(),
    });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMediaChange(inputUrl);
  };

  const handleResetMedia = () => {
    setInputUrl("");
    setEmbedWarning(null);
    onSyncPlayback({
      playing: false,
      currentTime: 0,
      playbackRate: 1.0,
      mediaUrl: "",
      mediaType: "none",
      hostTimeUpdated: Date.now(),
    });
  };

  return (
    <div className="w-full flex flex-col gap-4 lg:bg-white/[0.01] lg:backdrop-blur-3xl lg:rounded-3xl lg:border lg:border-white/5 lg:p-5 lg:shadow-2xl" id="media-player-container">
      {/* Main Display Stage: fixed to the top on mobile, relative on desktop */}
      <div className="fixed top-0 left-0 right-0 z-50 aspect-video bg-[#050505]/95 border-b border-white/10 flex items-center justify-center group shadow-[0_4px_30px_rgba(0,0,0,0.6)] lg:relative lg:top-auto lg:left-auto lg:right-auto lg:z-auto lg:bg-[#050505]/40 lg:rounded-2xl lg:overflow-hidden lg:border lg:border-white/5 lg:shadow-inner" id="media-stage">
        {playerState.mediaType === "none" ? (
          /* Empty Room Billboard */
          <div className="text-center p-8 flex flex-col items-center">
            <Globe className="w-16 h-16 stroke-[1] text-purple-500/20 mb-4 animate-pulse" />
            <h3 className="text-sm font-semibold text-white/40 uppercase tracking-widest">Theater Screen is Dark</h3>
            <p className="text-xs text-white/30 mt-2 max-w-sm font-medium">
              Wait for the host to broadcast a stream, paste a movie URL, or toggle WebRTC Screen Sharing! 🍿
            </p>
          </div>
        ) : playerState.mediaType === "iframe" ? (
          /* Embeddable Iframe Renderer */
          <div className="w-full h-full relative" id="iframe-viewer">
            <iframe
              src={playerState.mediaUrl}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="no-referrer"
              allowFullScreen
            />
            {/* Overlay notification warning manual frame controls sync limitation */}
            <div className="absolute top-4 left-4 right-4 bg-[#050505]/95 border border-white/10 backdrop-blur-md px-3.5 py-2.5 rounded-xl text-[10px] text-white/50 z-10 opacity-100 group-hover:opacity-100 transition duration-300 flex items-center justify-between pointer-events-none">
              <span className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-purple-400" />
                <span>Hosting via Iframe Embed. Note: frame click actions cannot sync. Use Screen Share if syncing is required!</span>
              </span>
              {isHost && (
                <button
                  onClick={handleResetMedia}
                  className="px-2.5 py-1 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-lg font-bold transition pointer-events-auto cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Direct HTML5 Player Stage with HLS */
          <div className="w-full h-full relative" id="video-viewer">
            <video
              ref={videoRef}
              preload="auto"
              className="w-full h-full object-contain"
              playsInline
              // Connect native triggers to synchronizing mechanics
              onPlay={() => handleLocalPlaybackEvent("play")}
              onPause={() => handleLocalPlaybackEvent("pause")}
              onSeeked={() => handleLocalPlaybackEvent("seek")}
              onRateChange={() => handleLocalPlaybackEvent("rate")}
              controls={canSendSync}
            />

            {/* Custom overlays when the controls are LOCKED to spectators */}
            {!canSendSync && (
              <div className="absolute top-4 right-4 bg-red-950/60 border border-red-500/30 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] text-red-300 pointer-events-none flex items-center gap-1.5 z-10 shadow-lg">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span>Controls Host Locked</span>
              </div>
            )}

            {/* Close stream overlay button for active host */}
            {isHost && (
              <button
                onClick={handleResetMedia}
                className="absolute top-4 left-4 p-2.5 bg-white/5 border border-white/10 text-white/55 hover:text-white hover:bg-white/10 rounded-full transition z-10 cursor-pointer"
                title="Unload Stream"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Search Input and status Bar */}
      <div className="flex flex-col gap-3 px-4 lg:px-0 mt-2">
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          <div className="flex-1 flex bg-white/5 border border-white/10 focus-within:border-purple-500/50 rounded-2xl px-4 py-3 items-center gap-3 transition">
            <Link className="w-5 h-5 text-white/40 shrink-0" />
            <input
              type="url"
              placeholder="Paste direct MP4, m3u8 HLS Stream, YouTube Link..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="bg-transparent flex-1 text-white text-xs focus:outline-none placeholder:text-white/20"
            />
          </div>
          <button
            type="submit"
            disabled={isUrlChecking || !inputUrl.trim()}
            className="px-6 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-2xl shadow-[0_0_20px_rgba(139,92,246,0.3)] active:scale-95 transition disabled:opacity-50 cursor-pointer"
          >
            {isUrlChecking ? "Checking..." : "Load Content"}
          </button>
        </form>

        {/* Warning Board */}
        {embedWarning && (
          <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl flex items-start gap-2.5 text-xs text-red-300 backdrop-blur-md">
            <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">Iframe Blocked</p>
              <p className="mt-0.5 text-white/40 font-sans tracking-wide leading-relaxed">{embedWarning}</p>
            </div>
            <button
              onClick={() => handlePresettedClick(STREAM_PRESETS[0].url)}
              className="px-2.5 py-1 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg text-[10px] shrink-0 font-bold tracking-wider uppercase transition cursor-pointer"
            >
              Play Presets
            </button>
          </div>
        )}
      </div>

      {/* Sync State Indicators */}
      <div className="flex flex-wrap items-center justify-between text-xs text-white/40 gap-2 px-5 lg:px-1">
        <div className="flex items-center gap-2">
          <div className="flex h-2.5 w-2.5 items-center justify-center">
            <span className={`absolute inline-flex h-2.5 w-2.5 rounded-full ${playerState.mediaType !== "none" ? "bg-emerald-500" : "bg-white/10"} opacity-75`} />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-widest">
            {playerState.mediaType !== "none" 
              ? `${playerState.mediaType} Stream Synced`
              : "Room Idle • Load a movie link!"}
          </span>
        </div>

        {playerState.mediaType !== "none" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-white/5 border border-white/5 text-white/50 px-2.5 py-1 rounded-lg">
              Rate: {playerState.playbackRate}x
            </span>
            {isHost && (
              <div className="flex gap-1.5">
                {[1.0, 1.25, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.playbackRate = rate;
                        handleLocalPlaybackEvent("rate");
                      }
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition cursor-pointer ${
                      playerState.playbackRate === rate 
                        ? "bg-purple-950/40 border-purple-500/40 text-purple-400 font-bold"
                        : "bg-transparent border-white/5 hover:border-white/10 hover:text-white/80"
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
