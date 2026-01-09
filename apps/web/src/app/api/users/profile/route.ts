import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/users/profile - Get current user's profile
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        bio: true,
        image: true,
        walletAddress: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("[profile] GET error:", error);
    return NextResponse.json(
      { error: "Failed to get profile" },
      { status: 500 }
    );
  }
}

// PUT/PATCH /api/users/profile - Update current user's profile
export async function PUT(request: Request) {
  return updateProfile(request);
}

export async function PATCH(request: Request) {
  return updateProfile(request);
}

async function updateProfile(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { username, name, bio } = body;

    // Validate username if provided
    if (username !== undefined) {
      // Username must be 1-9 characters, letters only
      if (username !== null && username !== "") {
        if (!/^[a-zA-Z]{1,9}$/.test(username)) {
          return NextResponse.json(
            {
              error:
                "Username must be 1-9 letters only",
            },
            { status: 400 }
          );
        }

        // Check if username is taken (case-insensitive)
        const existing = await prisma.user.findFirst({
          where: {
            username: { equals: username, mode: "insensitive" },
            NOT: { id: session.user.id },
          },
        });

        if (existing) {
          return NextResponse.json(
            { error: "Username is already taken" },
            { status: 400 }
          );
        }
      }
    }

    // Build update data
    const updateData: { username?: string | null; name?: string; bio?: string | null } = {};

    if (username !== undefined) {
      updateData.username = username === "" ? null : username;
    }
    if (name !== undefined) {
      updateData.name = name;
    }
    if (bio !== undefined) {
      updateData.bio = bio === "" ? null : bio;
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        bio: true,
        image: true,
        walletAddress: true,
        createdAt: true,
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    console.error("[profile] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
