import React, { useState, useEffect, useRef } from "react";
import { Message } from "../types";
import { Send, Smile, Info } from "lucide-react";

interface ChatPanelProps {
  messages: Message[];
  myId: string;
  onSendMessage: (text: string) => void;
  hideInput?: boolean;
}

const PRESET_EMOJIS = ["😀", "😂", "🔥", "🎉", "🍿", "🎬", "😍", "😱", "👍", "👏", "😮", "😴"];

export default function ChatPanel({ messages, myId, onSendMessage, hideInput = false }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle outside click to close emoji dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText("");
    setShowEmoji(false);
  };

  const addEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
  };

  return (
    <div className="flex flex-col h-full bg-white/[0.01] backdrop-blur-3xl rounded-2xl border border-white/5 overflow-hidden shadow-2xl" id="chat-panel">
      {/* Panel Header */}
      <div className="px-4 py-3 border-b border-white/5 bg-[#0a0a0a]/30 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white/90 tracking-wide font-sans flex items-center gap-1.5">
          <span>Party Chat</span>
          <span className="inline-flex h-2 w-2 rounded-full bg-purple-500 animate-ping" />
        </h3>
        <span className="text-[10px] text-white/40 font-mono tracking-widest uppercase">{messages.length} msgs</span>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-none">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/30 text-center px-4 py-8">
            <Info className="w-8 h-8 stroke-[1.5] text-purple-500/20 mb-2" />
            <p className="text-xs">No messages yet!</p>
            <p className="text-[10px] text-white/20 mt-1">Pop some popcorn and break the silence! 🍿</p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.type === "system") {
              return (
                <div key={msg.id} className="flex justify-center" id={`msg-${msg.id}`}>
                  <span className="px-3 py-1 text-[10px] font-bold text-purple-300 bg-purple-950/20 border border-purple-500/10 rounded-full text-center max-w-[90%] uppercase tracking-wider">
                    {msg.text}
                  </span>
                </div>
              );
            }

            const isMe = msg.userId === myId;

            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 max-w-[85%] ${isMe ? "ml-auto flex-row-reverse" : "mr-auto"}`}
                id={`msg-${msg.id}`}
              >
                {!isMe && (
                  <img
                    src={msg.userAvatar}
                    alt={msg.userName}
                    className="w-7 h-7 rounded-full border border-white/10 self-end mb-1 object-cover"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="flex flex-col">
                  {!isMe && (
                    <span className="text-[10px] font-bold text-white/40 ml-1.5 mb-0.5 uppercase tracking-wide">
                      {msg.userName}
                    </span>
                  )}
                  <div
                    className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed break-words shadow-lg ${
                      isMe
                        ? "bg-purple-600/80 border border-purple-500/30 text-white rounded-br-none backdrop-blur-md"
                        : "bg-white/5 border border-white/10 text-white/95 rounded-bl-none backdrop-blur-md"
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className={`text-[9px] text-white/30 px-1.5 mt-1 font-mono ${isMe ? "text-right" : "text-left"}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input controls */}
      {!hideInput && (
        <form onSubmit={handleSubmit} className="p-3 border-t border-white/5 bg-[#0a0a0a]/20 relative">
          {/* Emoji board */}
          {showEmoji && (
            <div
              ref={emojiRef}
              className="absolute bottom-16 right-4 p-2 bg-[#050505]/95 backdrop-blur-2xl border border-white/10 rounded-xl grid grid-cols-6 gap-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)] z-20"
            >
              {PRESET_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => addEmoji(emoji)}
                  className="w-8 h-8 text-lg flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors duration-150 cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="flex bg-white/5 border border-white/10 focus-within:border-purple-500/50 rounded-xl overflow-hidden transition-all duration-200">
            <button
              type="button"
              onClick={() => setShowEmoji((prev) => !prev)}
              className={`px-3 text-white/40 hover:text-purple-400 transition-colors focus:outline-none cursor-pointer ${
                showEmoji ? "text-purple-400" : ""
              }`}
            >
              <Smile className="w-5 h-5 stroke-[1.8]" />
            </button>
            
            <input
              type="text"
              placeholder="Type your message..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1 bg-transparent px-2 py-3 text-xs text-white placeholder:text-white/20 focus:outline-none"
              maxLength={180}
            />

            <button
              type="submit"
              disabled={!text.trim()}
              className="px-4 text-purple-400 disabled:text-white/20 hover:text-purple-300 transition-colors focus:outline-none cursor-pointer"
            >
              <Send className="w-4 h-4 stroke-[2]" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
