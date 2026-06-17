export interface Member {
  id: string; // Socket ID
  name: string;
  avatar: string; // Base64 SVG or color info
  isHost: boolean;
  cameraOn: boolean;
  micOn: boolean;
  isSharingScreen: boolean;
  webcamStreamId?: string | null;
  screenStreamId?: string | null;
}

export interface PlayerState {
  playing: boolean;
  currentTime: number;
  playbackRate: number;
  mediaUrl: string;
  mediaType: 'video' | 'iframe' | 'none';
  hostTimeUpdated: number; // local timestamp when updated
}

export interface Message {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  text: string;
  timestamp: number;
  type: 'user' | 'system';
}

export interface RoomState {
  id: string;
  members: Member[];
  playerState: PlayerState;
  messages: Message[];
  isPublicControl: boolean; // if true, any member can sync. if false, only host.
}

// signaling events for webrtc
export interface SignalData {
  from: string;
  to: string;
  signal: any;
  type: 'screen' | 'media'; // screen share separate from webcam/mic streams
}
