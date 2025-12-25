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
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  // Get local audio stream
  const startLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
      return stream;
    } catch (error) {
      console.error("Failed to get audio stream:", error);
      return null;
    }
  }, []);

  // Stop local stream
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  }, []);

  // Create peer connection for a remote user
  const createPeerConnection = useCallback(
    (targetSocketId: string, isInitiator: boolean) => {
      if (!socket || !localStreamRef.current) return null;

      const pc = new RTCPeerConnection(ICE_SERVERS);

      // Add local tracks
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      // Handle incoming tracks
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.set(targetSocketId, remoteStream);
            return next;
          });

          // Auto-play remote audio
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
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
    }
  }, []);

  // Close all peer connections
  const closeAllPeerConnections = useCallback(() => {
    peersRef.current.forEach((peer) => {
      peer.connection.close();
    });
    peersRef.current.clear();
    setRemoteStreams(new Map());
  }, []);

  // Handle WebRTC signaling events
  useEffect(() => {
    if (!socket) return;

    // Handle voice members list (when joining voice)
    const handleVoiceMembers = async ({ members }: { members: LobbyMember[] }) => {
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
