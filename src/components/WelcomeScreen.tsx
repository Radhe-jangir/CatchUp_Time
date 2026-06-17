import React, { useState, useEffect } from "react";
import { generateAvatar } from "./AvatarGenerator";
import { Film, Sparkles, LogIn, Plus } from "lucide-react";

interface WelcomeScreenProps {
  onJoin: (username: string, avatar: string, roomId: string) => void;
  initialRoomId?: string;
}

const FUN_NAMES = [
  "NeonCinephile", "CyberPopcorn", "SpectraGazer", "PopcornGamer", "LaserLens",
  "PixelViewer", "CosmicShow", "SyncoStreamer", "AeroViewer", "DeltaFilm",
  "VortexVision", "GlowGator", "QuantumPlayer", "LunaScreen", "StreamMaster"
];

export default function WelcomeScreen({ onJoin, initialRoomId = "" }: WelcomeScreenProps) {
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState("");
  const [roomId, setRoomId] = useState(initialRoomId);
  const [error, setError] = useState("");

  // Auto-generate random name at load
  useEffect(() => {
    const randomIdx = Math.floor(Math.random() * FUN_NAMES.length);
    const suffix = Math.floor(100 + Math.random() * 900);
    const defaultName = `${FUN_NAMES[randomIdx]}_${suffix}`;
    setUsername(defaultName);
  }, []);

  // Sync avatar representation of active name
  useEffect(() => {
    if (username.trim()) {
      setAvatar(generateAvatar(username.trim()));
    }
  }, [username]);

  const handleCreateRoom = () => {
    if (!username.trim()) {
      setError("Please put a display name!");
      return;
    }
    const generatedId = Math.random().toString(36).substring(2, 10).toUpperCase();
    onJoin(username.trim(), avatar, generatedId);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError("Please enter a display name first!");
      return;
    }
    if (!roomId.trim()) {
      setError("Please enter a valid 8-character Room ID!");
      return;
    }
    onJoin(username.trim(), avatar, roomId.trim().toUpperCase());
  };

  const randomizeName = () => {
    const randomIdx = Math.floor(Math.random() * FUN_NAMES.length);
    const suffix = Math.floor(100 + Math.random() * 900);
    setUsername(`${FUN_NAMES[randomIdx]}_${suffix}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#050505] text-[#f8fafc] select-none relative">
      {/* Background Neon Glows */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md bg-white/[0.02] backdrop-blur-3xl border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10 overflow-hidden" id="welcome-card">
        {/* Neon accent top bar */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 shadow-[0_1px_15px_rgba(168,85,247,0.5)]" />

        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-white/5 rounded-2xl border border-white/10 text-purple-400 mb-3" id="logo-icon">
            <Film className="w-10 h-10 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-purple-300 to-pink-300 bg-clip-text text-transparent">
            Movie<span className="text-purple-400 font-black">Dekhe</span>
          </h1>
          <p className="text-white/40 text-xs mt-2 font-medium uppercase tracking-wider">
            Premium Cinema Experience
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs text-center mb-6 backdrop-blur-md">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Avatar Preview & Display Name */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <div className="absolute -inset-1.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full blur opacity-25 group-hover:opacity-60 transition duration-500" />
              {avatar ? (
                <img
                  src={avatar}
                  alt="Avatar"
                  className="w-24 h-24 rounded-full border border-white/20 object-cover relative shadow-xl"
                  referrerPolicy="no-referrer"
                  id="avatar-preview"
                />
              ) : (
                <div className="w-24 h-24 bg-white/5 rounded-full border border-white/10 relative flex items-center justify-center text-white/30">
                  Loading...
                </div>
              )}
              <button
                type="button"
                onClick={randomizeName}
                title="Randomize pseudonym"
                className="absolute -bottom-1 -right-1 p-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full text-white shadow-lg hover:scale-110 active:scale-95 transition-all outline-none border border-white/20"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full">
              <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 text-center">
                Your Display Name
              </label>
              <input
                type="text"
                placeholder="Pick a nickname..."
                value={username}
                onChange={(e) => setUsername(e.target.value.substring(0, 20))}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-medium text-center focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all shadow-inner placeholder:text-white/20 text-sm"
                maxLength={20}
                required
              />
            </div>
          </div>

          <div className="h-[1.5px] bg-gradient-to-r from-transparent via-white/10 to-transparent my-2" />

          {/* Action Blocks */}
          <div className="space-y-4">
            {/* Create Room Button */}
            <button
              onClick={handleCreateRoom}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-purple-600 hover:bg-purple-500 active:scale-[0.98] text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] group cursor-pointer text-sm"
              id="btn-create-room"
            >
              <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
              Create Watch Party Room
            </button>

            <div className="flex items-center justify-center gap-3 text-white/20 text-[10px] uppercase font-bold tracking-widest my-2">
              <span className="w-12 h-[1px] bg-white/10" />
              <span>or join party</span>
              <span className="w-12 h-[1px] bg-white/10" />
            </div>

            {/* Join Room Form */}
            <form onSubmit={handleJoinRoom} className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="8-Character Room ID..."
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="flex-1 px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white font-medium text-center focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/30 transition-all font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal placeholder:text-white/20 text-sm"
                  maxLength={12}
                  required
                />
                <button
                  type="submit"
                  className="px-5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 active:scale-95 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(236,72,153,0.3)] flex items-center justify-center gap-2 cursor-pointer text-sm"
                  id="btn-join-room"
                >
                  <LogIn className="w-5 h-5" />
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-white/30 uppercase tracking-widest font-semibold">
          ⚡ Voice, webcam grids & screen share
        </div>
      </div>
    </div>
  );
}
