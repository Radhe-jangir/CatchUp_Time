import express from "express";
import http from "http";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { createServer as createViteServer } from "vite";
import { RoomState, Member, Message, PlayerState } from "./src/types";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);

  // Set up Socket.IO with CORS
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    // Required to prevent connection dropping over slow networks
    pingTimeout: 30000,
    pingInterval: 15000,
  });

  // Middleware
  app.use(express.json());

  // Memory store for active rooms
  const rooms = new Map<string, RoomState>();

  // API Endpoint: Check if a URL can be embedded in an iframe
  app.get("/api/check-embed", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ embeddable: false, error: "URL is required" });
    }

    try {
      const urlObj = new URL(targetUrl);
      
      // If it is YouTube, we can easily rewrite to embed format on client, so allow it!
      if (urlObj.hostname.includes("youtube.com") || urlObj.hostname.includes("youtu.be") || urlObj.hostname.includes("vimeo.com")) {
        return res.json({ embeddable: true });
      }

      // Check URL header restrictions via fetch with a short timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WatchParty/1.0",
        },
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      if (!response) {
        // Failed to fetch generally means either blocked or offline, but let's default to screen share recommendation
        return res.json({ 
          embeddable: false, 
          reason: "unreachable", 
          message: "Check failed. The website might be blocking direct server calls. Screen Share Mode is highly recommended instead." 
        });
      }

      const xFrameOptions = response.headers.get("x-frame-options")?.toLowerCase();
      const csp = response.headers.get("content-security-policy")?.toLowerCase();

      let embeddable = true;
      let reason = "";

      if (xFrameOptions === "deny" || xFrameOptions === "sameorigin") {
        embeddable = false;
        reason = "x-frame-options";
      } else if (csp && (csp.includes("frame-ancestors 'none'") || csp.includes("frame-ancestors 'self'"))) {
        embeddable = false;
        reason = "csp";
      }

      return res.json({ 
        embeddable, 
        reason,
        message: embeddable ? null : "This website blocks iframe embedding via X-Frame-Options or CSP headers. Please use WebRTC Screen Share Mode instead!"
      });
    } catch (e: any) {
      return res.json({ 
        embeddable: false, 
        reason: "invalid_url", 
        message: "Invalid URL format. Please make sure to include http:// or https://." 
      });
    }
  });

  // Socket.IO signaling & room logic
  io.on("connection", (socket) => {
    let currentRoomId: string | null = null;
    let userId = socket.id;

    // Helper: room broadcast that updates all clients
    const broadcastRoomUpdate = (roomId: string) => {
      const room = rooms.get(roomId);
      if (room) {
        io.to(roomId).emit("room-updated", room);
      }
    };

    // User creates/joins a room
    socket.on("join-room", ({ roomId, userName, avatar }: { roomId: string; userName: string; avatar: string }) => {
      currentRoomId = roomId;
      socket.join(roomId);

      let room = rooms.get(roomId);

      if (!room) {
        // Create new room under host
        const initialPlayerState: PlayerState = {
          playing: false,
          currentTime: 0,
          playbackRate: 1.0,
          mediaUrl: "",
          mediaType: "none",
          hostTimeUpdated: Date.now(),
        };

        room = {
          id: roomId,
          members: [],
          playerState: initialPlayerState,
          messages: [],
          isPublicControl: true, // Let participants have control by default, host can toggle later
        };
        rooms.set(roomId, room);
      }

      // Check if user is already in the room's members (to prevent duplicates)
      const existingMemberIndex = room.members.findIndex(m => m.id === userId);
      
      const isHost = room.members.length === 0; // First user is host

      const member: Member = {
        id: userId,
        name: userName || `User-${userId.substring(0, 4)}`,
        avatar,
        isHost,
        cameraOn: false,
        micOn: false,
        isSharingScreen: false,
      };

      if (existingMemberIndex >= 0) {
        room.members[existingMemberIndex] = member;
      } else {
        room.members.push(member);
      }

      // Generate join notification
      const joinMsg: Message = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        userId: "system",
        userName: "System",
        userAvatar: "",
        text: `${member.name} joined the watch party! ✨`,
        timestamp: Date.now(),
        type: "system",
      };
      room.messages.push(joinMsg);

      // Keep messages to last 150
      if (room.messages.length > 200) {
        room.messages.shift();
      }

      // Sync user on join
      socket.emit("sync-init-state", {
        roomState: room,
        yourId: userId,
      });

      // Broadcast update to others
      socket.to(roomId).emit("user-connected", { userId, member });
      broadcastRoomUpdate(roomId);
    });

    // Handle RTC Signaling packets
    socket.on("signal", (data: { to: string; signal: any; type: "screen" | "media"; fromSenderName: string }) => {
      // Forward peer negotiation signaling seamlessly
      io.to(data.to).emit("signal", {
        from: socket.id,
        signal: data.signal,
        type: data.type,
        fromSenderName: data.fromSenderName,
      });
    });

    // Notify room of streamer intent (Webcams, screenshare trigger)
    socket.on("stream-state-changed", ({ cameraOn, micOn, isSharingScreen, webcamStreamId, screenStreamId }: { cameraOn: boolean; micOn: boolean; isSharingScreen: boolean; webcamStreamId?: string | null; screenStreamId?: string | null }) => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        const member = room.members.find(m => m.id === userId);
        if (member) {
          member.cameraOn = cameraOn;
          member.micOn = micOn;
          member.isSharingScreen = isSharingScreen;
          member.webcamStreamId = webcamStreamId || null;
          member.screenStreamId = screenStreamId || null;
          
          broadcastRoomUpdate(currentRoomId);
          // Notify room so other peers know to create custom PeerConnections to this user
          socket.to(currentRoomId).emit("peer-stream-updated", {
            userId,
            cameraOn,
            micOn,
            isSharingScreen,
            webcamStreamId,
            screenStreamId,
          });
        }
      }
    });

    // Synchronize media play/pause/seek/speed across room
    socket.on("sync-playback", (newPlayerState: PlayerState) => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        // Validate permission
        const sender = room.members.find(m => m.id === userId);
        const canSync = room.isPublicControl || (sender && sender.isHost);
        
        if (canSync) {
          room.playerState = {
            ...newPlayerState,
            hostTimeUpdated: Date.now(),
          };
          // Broadcast player updates to all others in the room
          socket.to(currentRoomId).emit("playback-synced", room.playerState);
        }
      }
    });

    // Toggle locks for user playback adjustments
    socket.on("toggle-control-mode", ({ isPublicControl }: { isPublicControl: boolean }) => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        const sender = room.members.find(m => m.id === userId);
        if (sender && sender.isHost) {
          room.isPublicControl = isPublicControl;
          
          const sysMsg: Message = {
            id: `sys-${Date.now()}`,
            userId: "system",
            userName: "System",
            userAvatar: "",
            text: isPublicControl 
              ? "Playback controls are now unlocked! Everyone can play, pause, or seek. 🔓"
              : "Playback controls are now locked! Only the Host can control the video. 🔒",
            timestamp: Date.now(),
            type: "system",
          };
          room.messages.push(sysMsg);
          broadcastRoomUpdate(currentRoomId);
        }
      }
    });

    // Post messaging chat events
    socket.on("send-message", (text: string) => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        const sender = room.members.find(m => m.id === userId);
        if (sender) {
          const newMsg: Message = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            userId,
            userName: sender.name,
            userAvatar: sender.avatar,
            text,
            timestamp: Date.now(),
            type: "user",
          };
          room.messages.push(newMsg);
          if (room.messages.length > 200) room.messages.shift();
          
          io.to(currentRoomId).emit("message-received", newMsg);
        }
      }
    });

    // Host manually transfers host status to someone else
    socket.on("transfer-host", (targetMemberId: string) => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        const sender = room.members.find(m => m.id === userId);
        if (sender && sender.isHost) {
          const target = room.members.find(m => m.id === targetMemberId);
          if (target) {
            sender.isHost = false;
            target.isHost = true;

            const changeMsg: Message = {
              id: `sys-${Date.now()}`,
              userId: "system",
              userName: "System",
              userAvatar: "",
              text: `👑 Host transferred to ${target.name}.`,
              timestamp: Date.now(),
              type: "system",
            };
            room.messages.push(changeMsg);
            broadcastRoomUpdate(currentRoomId);
          }
        }
      }
    });

    // Leave/Disconnect trigger
    const handleDisconnect = () => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room) {
        const leavingMember = room.members.find(m => m.id === userId);
        if (!leavingMember) return;

        // Remove from members
        room.members = room.members.filter(m => m.id !== userId);

        // System leave alert
        const leaveMsg: Message = {
          id: `sys-${Date.now()}`,
          userId: "system",
          userName: "System",
          userAvatar: "",
          text: `${leavingMember.name} left the party. 👋`,
          timestamp: Date.now(),
          type: "system",
        };
        room.messages.push(leaveMsg);

        // Assign new host if leaving user was the host
        if (leavingMember.isHost && room.members.length > 0) {
          room.members[0].isHost = true;
          const hostChangeAlert: Message = {
            id: `sys-${Date.now()}-host`,
            userId: "system",
            userName: "System",
            userAvatar: "",
            text: `${room.members[0].name} is now the host! 👑`,
            timestamp: Date.now(),
            type: "system",
          };
          room.messages.push(hostChangeAlert);
        }

        // Clean up empty room
        if (room.members.length === 0) {
          rooms.delete(currentRoomId);
        } else {
          broadcastRoomUpdate(currentRoomId);
          // Notify room of client teardown
          socket.to(currentRoomId).emit("user-disconnected", { userId });
        }
      }
      currentRoomId = null;
    };

    socket.on("leave-room", handleDisconnect);
    socket.on("disconnect", handleDisconnect);

    // Bounces a ping request immediately to measure round-trip latency
    socket.on("ping-test", (timestamp: number) => {
      socket.emit("pong-test", timestamp);
    });
  });

  // Serve static assets in development & production
  if (process.env.NODE_ENV !== "production") {
    // Vite middleware for lightning-fast HMR-less updates during dev
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Native static deployment for Render / standalone container mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`MovieDekhe fullstack server booted successfully on port ${PORT}`);
  });
}

startServer();
