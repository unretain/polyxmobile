"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { LobbyMember } from "@/stores/lobbyStore";

interface PeerConnection {
  socketId: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

interface UseVoiceChatProps {
  socket: Socket | null;
  inVoice: boolean;
  onVoiceMemberJoined?: (member: LobbyMember) => void;
  onVoiceMemberLeft?: (socketId: string) => void;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function useVoiceChat({
  socket,
  inVoice,
  onVoiceMemberJoined,
  onVoiceMemberLeft,
}: UseVoiceChatProps) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localStreamReady, setLocalStreamReady] = useState(false);
  const pendingMembersRef = useRef<LobbyMember[]>([]);

  // Get local audio stream
  const startLocalStream = useCallback(async () => {
    try {
      console.log("[Voice] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
      setLocalStreamReady(true);
      console.log("[Voice] Microphone access granted, stream ready");
      return stream;
    } catch (error) {
      console.error("[Voice] Failed to get audio stream:", error);
      setLocalStreamReady(false);
      return null;
    }
  }, []);

  // Stop local stream
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStreamReady(false);
    pendingMembersRef.current = [];
  }, []);

  // Create peer connection for a remote user
  const createPeerConnection = useCallback(
    (targetSocketId: string, isInitiator: boolean) => {
      if (!socket) {
        console.log("[Voice] No socket, cannot create peer connection");
        return null;
      }
      if (!localStreamRef.current) {
        console.log("[Voice] No local stream yet, cannot create peer connection");
        return null;
      }

      console.log(`[Voice] Creating peer connection to ${targetSocketId}, initiator: ${isInitiator}`);
      const pc = new RTCPeerConnection(ICE_SERVERS);

      // Add local tracks
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      // Handle incoming tracks
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) {
          console.log(`[Voice] Received remote stream from ${targetSocketId}`);
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.set(targetSocketId, remoteStream);
            return next;
          });

          // Create and store audio element to prevent garbage collection
          let audio = audioElementsRef.current.get(targetSocketId);
          if (!audio) {
            audio = new Audio();
            audioElementsRef.current.set(targetSocketId, audio);
          }
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          audio.volume = 1.0;

          // Explicitly try to play (needed for some browsers)
          audio.play().then(() => {
            console.log(`[Voice] Playing audio from ${targetSocketId}`);
          }).catch((err) => {
            console.error(`[Voice] Failed to play audio from ${targetSocketId}:`, err);
          });
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("voice:ice-candidate", {
            targetSocketId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          console.log(`Connection to ${targetSocketId} ${pc.connectionState}`);
        }
      };

      const peerConn: PeerConnection = {
        socketId: targetSocketId,
        connection: pc,
      };

      peersRef.current.set(targetSocketId, peerConn);

      // If initiator, create and send offer
      if (isInitiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit("voice:offer", {
              targetSocketId,
              offer: pc.localDescription,
            });
          })
          .catch(console.error);
      }

      return pc;
    },
    [socket]
  );

  // Close peer connection
  const closePeerConnection = useCallback((socketId: string) => {
    const peer = peersRef.current.get(socketId);
    if (peer) {
      peer.connection.close();
      peersRef.current.delete(socketId);
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
      // Clean up audio element
      const audio = audioElementsRef.current.get(socketId);
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        audioElementsRef.current.delete(socketId);
      }
    }
  }, []);

  // Close all peer connections
  const closeAllPeerConnections = useCallback(() => {
    peersRef.current.forEach((peer) => {
      peer.connection.close();
    });
    peersRef.current.clear();
    setRemoteStreams(new Map());
    // Clean up all audio elements
    audioElementsRef.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });
    audioElementsRef.current.clear();
  }, []);

  // Handle WebRTC signaling events
  useEffect(() => {
    if (!socket) return;

    // Handle voice members list (when joining voice)
    const handleVoiceMembers = async ({ members }: { members: LobbyMember[] }) => {
      console.log(`[Voice] Received voice members list: ${members.length} members`);
      // Store pending members - we'll connect when stream is ready
      if (!localStreamRef.current) {
        console.log("[Voice] Stream not ready, queuing members for later connection");
        pendingMembersRef.current = members;
        return;
      }
      // Create peer connections to all existing voice members
      for (const member of members) {
        createPeerConnection(member.odId, true); // We are the initiator
      }
    };

    // Handle new user joining voice
    const handleVoiceUserJoined = (member: LobbyMember) => {
      onVoiceMemberJoined?.(member);
      // Wait for their offer (they are not the initiator since they joined after us)
    };

    // Handle user leaving voice
    const handleVoiceUserLeft = ({ odId }: { odId: string }) => {
      closePeerConnection(odId);
      onVoiceMemberLeft?.(odId);
    };

    // Handle incoming offer
    const handleVoiceOffer = async ({
      fromSocketId,
      offer,
    }: {
      fromSocketId: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      // Create peer connection for the offerer
      const pc = createPeerConnection(fromSocketId, false);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("voice:answer", {
          targetSocketId: fromSocketId,
          answer: pc.localDescription,
        });
      } catch (error) {
        console.error("Failed to handle offer:", error);
      }
    };

    // Handle incoming answer
    const handleVoiceAnswer = async ({
      fromSocketId,
      answer,
    }: {
      fromSocketId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      const peer = peersRef.current.get(fromSocketId);
      if (!peer) return;

      try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error("Failed to handle answer:", error);
      }
    };

    // Handle incoming ICE candidate
    const handleIceCandidate = async ({
      fromSocketId,
      candidate,
    }: {
      fromSocketId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const peer = peersRef.current.get(fromSocketId);
      if (!peer) return;

      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Failed to add ICE candidate:", error);
      }
    };

    socket.on("voice:members", handleVoiceMembers);
    socket.on("voice:userJoined", handleVoiceUserJoined);
    socket.on("voice:userLeft", handleVoiceUserLeft);
    socket.on("voice:offer", handleVoiceOffer);
    socket.on("voice:answer", handleVoiceAnswer);
    socket.on("voice:ice-candidate", handleIceCandidate);

    return () => {
      socket.off("voice:members", handleVoiceMembers);
      socket.off("voice:userJoined", handleVoiceUserJoined);
      socket.off("voice:userLeft", handleVoiceUserLeft);
      socket.off("voice:offer", handleVoiceOffer);
      socket.off("voice:answer", handleVoiceAnswer);
      socket.off("voice:ice-candidate", handleIceCandidate);
    };
  }, [socket, createPeerConnection, closePeerConnection, onVoiceMemberJoined, onVoiceMemberLeft]);

  // Start/stop voice based on inVoice state
  useEffect(() => {
    if (inVoice) {
      startLocalStream();
    } else {
      stopLocalStream();
      closeAllPeerConnections();
    }

    return () => {
      stopLocalStream();
      closeAllPeerConnections();
    };
  }, [inVoice, startLocalStream, stopLocalStream, closeAllPeerConnections]);

  // Process pending members when stream becomes ready
  useEffect(() => {
    if (localStreamReady && pendingMembersRef.current.length > 0) {
      console.log(`[Voice] Stream ready, connecting to ${pendingMembersRef.current.length} pending members`);
      for (const member of pendingMembersRef.current) {
        createPeerConnection(member.odId, true);
      }
      pendingMembersRef.current = [];
    }
  }, [localStreamReady, createPeerConnection]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = isMuted;
        setIsMuted(!isMuted);
      }
    }
  }, [isMuted]);

  // Toggle deafen
  const toggleDeafen = useCallback(() => {
    const newDeafened = !isDeafened;
    setIsDeafened(newDeafened);

    // Mute all remote streams
    remoteStreams.forEach((stream) => {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !newDeafened;
      });
    });

    // Also mute self when deafened
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        if (newDeafened) {
          audioTrack.enabled = false;
          setIsMuted(true);
        }
      }
    }
  }, [isDeafened, remoteStreams]);

  return {
    isMuted,
    isDeafened,
    toggleMute,
    toggleDeafen,
    remoteStreams,
    peerCount: peersRef.current.size,
  };
}
