import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// DELETE /api/friends/[friendId] - Remove a friend
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ friendId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { friendId } = await params;

    // Delete both directions of the friendship
    await prisma.$transaction([
      prisma.friendship.deleteMany({
        where: {
          userId: session.user.id,
          friendId: friendId,
        },
      }),
      prisma.friendship.deleteMany({
        where: {
          userId: friendId,
          friendId: session.user.id,
        },
      }),
    ]);

    return NextResponse.json({ message: "Friend removed" });
  } catch (error) {
    console.error("[friends/friendId] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove friend" },
      { status: 500 }
    );
  }
}
