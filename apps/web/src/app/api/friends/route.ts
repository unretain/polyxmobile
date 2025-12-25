import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/friends - Get current user's friends and pending requests
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get friends (both directions)
    const friendships = await prisma.friendship.findMany({
      where: { userId: session.user.id },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            name: true,
            image: true,
          },
        },
      },
    });

    // Get pending friend requests (received)
    const pendingRequests = await prisma.friendRequest.findMany({
      where: {
        receiverId: session.user.id,
        status: "pending",
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            image: true,
          },
        },
      },
    });

    // Get sent requests (pending)
    const sentRequests = await prisma.friendRequest.findMany({
      where: {
        senderId: session.user.id,
        status: "pending",
      },
      include: {
        receiver: {
          select: {
            id: true,
            username: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json({
      friends: friendships.map((f) => f.friend),
      pendingRequests: pendingRequests.map((r) => ({
        id: r.id,
        sender: r.sender,
        createdAt: r.createdAt,
      })),
      sentRequests: sentRequests.map((r) => ({
        id: r.id,
        receiver: r.receiver,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error("[friends] GET error:", error);
    return NextResponse.json(
      { error: "Failed to get friends" },
      { status: 500 }
    );
  }
}
