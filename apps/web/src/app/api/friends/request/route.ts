import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/friends/request - Send a friend request by username
export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { username } = body;

    if (!username) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    // Find user by username (case-insensitive)
    const targetUser = await prisma.user.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
      },
      select: { id: true, username: true, name: true, image: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Can't add yourself
    if (targetUser.id === session.user.id) {
      return NextResponse.json(
        { error: "You cannot add yourself as a friend" },
        { status: 400 }
      );
    }

    // Check if already friends
    const existingFriendship = await prisma.friendship.findUnique({
      where: {
        userId_friendId: {
          userId: session.user.id,
          friendId: targetUser.id,
        },
      },
    });

    if (existingFriendship) {
      return NextResponse.json(
        { error: "You are already friends" },
        { status: 400 }
      );
    }

    // Check if request already exists (in either direction)
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: session.user.id, receiverId: targetUser.id },
          { senderId: targetUser.id, receiverId: session.user.id },
        ],
        status: "pending",
      },
    });

    if (existingRequest) {
      // If they sent us a request, accept it instead
      if (existingRequest.senderId === targetUser.id) {
        // Accept their request
        await prisma.$transaction([
          prisma.friendRequest.update({
            where: { id: existingRequest.id },
            data: { status: "accepted" },
          }),
          prisma.friendship.create({
            data: {
              userId: session.user.id,
              friendId: targetUser.id,
            },
          }),
          prisma.friendship.create({
            data: {
              userId: targetUser.id,
              friendId: session.user.id,
            },
          }),
        ]);

        return NextResponse.json({
          message: "Friend request accepted",
          friend: targetUser,
        });
      }

      return NextResponse.json(
        { error: "Friend request already sent" },
        { status: 400 }
      );
    }

    // Create friend request
    const friendRequest = await prisma.friendRequest.create({
      data: {
        senderId: session.user.id,
        receiverId: targetUser.id,
      },
    });

    return NextResponse.json({
      message: "Friend request sent",
      request: {
        id: friendRequest.id,
        receiver: targetUser,
      },
    });
  } catch (error) {
    console.error("[friends/request] POST error:", error);
    return NextResponse.json(
      { error: "Failed to send friend request" },
      { status: 500 }
    );
  }
}
