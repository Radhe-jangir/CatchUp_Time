import React, { useState } from "react";
import { Member } from "../types";
import { Crown, Mic, MicOff, Video, VideoOff, Monitor, Share2, Copy, Check } from "lucide-react";

interface MembersPanelProps {
  members: Member[];
  myId: string;
  roomId: string;
  onTransferHost: (memberId: string) => void;
}

export default function MembersPanel({ members, myId, roomId, onTransferHost }: MembersPanelProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const myMember = members.find((m) => m.id === myId);
  const isMeHost = myMember?.isHost || false;

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyInviteLink = () => {
    // Generate full shareable URL linking to this watch party
    const inviteUrl = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="bg-[#050505]/20 backdrop-blur-3xl rounded-2xl border border-white/5 p-4 space-y-5 shadow-2xl" id="members-panel">
      {/* Invite Area */}
      <div>
        <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-3 flex items-center gap-1.5 font-sans">
          <Share2 className="w-3.5 h-3.5 text-purple-400" />
          <span>Invite Friends</span>
        </h3>
        
        <div className="grid grid-cols-2 gap-2">
          {/* Room ID Copy */}
          <button
            onClick={copyRoomCode}
            className="flex items-center justify-between gap-1 px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 active:border-purple-500 rounded-xl text-xs transition duration-150 group cursor-pointer"
          >
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[8px] text-white/30 font-sans tracking-widest font-bold">ROOM ID</span>
              <span className="font-mono text-purple-300 font-semibold truncate w-full">{roomId}</span>
            </div>
            {copiedCode ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-4 h-4 text-white/40 group-hover:text-purple-400 shrink-0" />
            )}
          </button>

          {/* Full Link Invite Copy */}
          <button
            onClick={copyInviteLink}
            className="flex items-center justify-between gap-1 px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 active:border-pink-500 rounded-xl text-xs transition duration-150 group cursor-pointer"
          >
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[8px] text-white/30 font-sans tracking-widest font-bold">INVITE LINK</span>
              <span className="font-sans text-pink-300 font-semibold truncate w-full">Copy URL</span>
            </div>
            {copiedLink ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-4 h-4 text-white/40 group-hover:text-pink-400 shrink-0" />
            )}
          </button>
        </div>
      </div>

      <div className="h-[1px] bg-white/5" />

      {/* Members List */}
      <div>
        <div className="flex items-center justify-between mb-3 text-[10px] font-bold text-white/40 uppercase tracking-widest font-sans">
          <h4>Audience List</h4>
          <span className="px-2.5 py-0.5 bg-purple-950/20 border border-purple-500/10 text-purple-300 rounded-full text-[9px] font-mono font-medium">
            {members.length} {members.length === 1 ? "Watcher" : "Watchers"}
          </span>
        </div>

        <div className="space-y-2 max-h-[220px] overflow-y-auto scrollbar-none pr-1">
          {members.map((member) => {
            const isMe = member.id === myId;
            return (
              <div
                key={member.id}
                className={`flex items-center justify-between p-2 rounded-xl border transition-all duration-200 ${
                  isMe ? "bg-purple-950/10 border-purple-500/20" : "bg-white/5 border-transparent hover:bg-white/10"
                }`}
                id={`member-${member.id}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative">
                    <img
                      src={member.avatar}
                      alt={member.name}
                      className="w-8 h-8 rounded-full border border-white/10 object-cover"
                      referrerPolicy="no-referrer"
                    />
                    {member.isHost && (
                      <span className="absolute -top-1.5 -right-1.5 p-0.5 bg-amber-500 rounded-full text-black shadow-lg" title="Crown Host">
                        <Crown className="w-2.5 h-2.5 fill-current" />
                      </span>
                    )}
                  </div>
                  
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-white/90 truncate flex items-center gap-1">
                      {member.name}
                      {isMe && <span className="text-[9px] text-white/40 font-sans font-normal">(You)</span>}
                    </span>
                    <div className="flex items-center gap-1.5 text-white/30 mt-0.5">
                      {member.cameraOn ? (
                        <Video className="w-3 h-3 text-purple-400" />
                      ) : (
                        <VideoOff className="w-3 h-3 text-white/10" />
                      )}
                      
                      {member.micOn ? (
                        <Mic className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <MicOff className="w-3 h-3 text-white/10" />
                      )}

                      {member.isSharingScreen && (
                        <Monitor className="w-3 h-3 text-pink-400 animate-pulse" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Host Control Actions */}
                {isMeHost && !member.isHost && (
                  <button
                    onClick={() => onTransferHost(member.id)}
                    title="Make Room Host"
                    className="p-1.5 hover:bg-yellow-500/10 border border-transparent hover:border-yellow-500/30 text-white/30 hover:text-yellow-400 rounded-lg transition duration-200 shrink-0 cursor-pointer"
                  >
                    <Crown className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
