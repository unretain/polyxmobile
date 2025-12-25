import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/friends/request/[id] - Accept or reject a friend request
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { action } = body; // "accept" or "reject"

    if (!["accept", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Use 'accept' or 'reject'" },
        { status: 400 }
      );
    }

    // Find the friend request
    const friendRequest = await prisma.friendRequest.findUnique({
      where: { id },
      include: {
        sender: {
          select: { id: true, username: true, name: true, image: true },
        },
      },
    });

    if (!friendRequest) {
      return NextResponse.json(
        { error: "Friend request not found" },
        { status: 404 }
      );
    }

    // Must be the receiver
    if (friendRequest.receiverId !== session.user.id) {
      return NextResponse.json(
        { error: "You can only respond to requests sent to you" },
        { status: 403 }
      );
    }

    if (friendRequest.status !== "pending") {
      return NextResponse.json(
        { error: "This request has already been responded to" },
        { status: 400 }
      );
    }

    if (action === "accept") {
      // Accept: update request and create bidirectional friendship
      await prisma.$transaction([
        prisma.friendRequest.update({
          where: { id },
          data: { status: "accepted" },
        }),
        prisma.friendship.create({
          data: {
            userId: session.user.id,
            friendId: friendRequest.senderId,
          },
        }),
        prisma.friendship.create({
          data: {
            userId: friendRequest.senderId,
            friendId: session.user.id,
          },
        }),
      ]);

      return NextResponse.json({
        message: "Friend request accepted",
        friend: friendRequest.sender,
      });
    } else {
      // Reject: just update status
      await prisma.friendRequest.update({
        where: { id },
        data: { status: "rejected" },
      });

      return NextResponse.json({ message: "Friend request rejected" });
    }
  } catch (error) {
    console.error("[friends/request/id] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to respond to friend request" },
      { status: 500 }
    );
  }
}

// DELETE /api/friends/request/[id] - Cancel a sent friend request
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { id } = await params;

    const friendRequest = await prisma.friendRequest.findUnique({
      where: { id },
    });

    if (!friendRequest) {
      return NextResponse.json(
        { error: "Friend request not found" },
        { status: 404 }
      );
    }

    // Must be the sender
    if (friendRequest.senderId !== session.user.id) {
      return NextResponse.json(
        { error: "You can only cancel requests you sent" },
        { status: 403 }
      );
    }

    await prisma.friendRequest.delete({ where: { id } });

    return NextResponse.json({ message: "Friend request cancelled" });
  } catch (error) {
    console.error("[friends/request/id] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to cancel friend request" },
      { status: 500 }
    );
  }
}
