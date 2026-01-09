import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// POST /api/users/profile-picture - Upload profile picture
export async function POST(request: Request) {
  try {
    // Check if Supabase is configured
    if (!isSupabaseConfigured() || !supabase) {
      return NextResponse.json(
        { error: "Profile picture uploads are not configured" },
        { status: 503 }
      );
    }

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Use JPEG, PNG, WebP, or GIF" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Max 5MB" },
        { status: 400 }
      );
    }

    // Generate unique filename
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${session.user.id}/${Date.now()}.${ext}`;

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Delete old profile picture if exists
    const oldUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { image: true },
    });

    if (oldUser?.image?.includes("supabase")) {
      // Extract old path and delete
      const oldPath = oldUser.image.split("/profile-pictures/")[1];
      if (oldPath) {
        await supabase.storage.from("profile-pictures").remove([oldPath]);
      }
    }

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from("profile-pictures")
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (error) {
      console.error("[profile-picture] Upload error:", error);
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("profile-pictures")
      .getPublicUrl(data.path);

    const imageUrl = urlData.publicUrl;

    // Update user's image in database
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { image: imageUrl },
      select: {
        id: true,
        image: true,
      },
    });

    return NextResponse.json({ image: user.image });
  } catch (error) {
    console.error("[profile-picture] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload profile picture" },
      { status: 500 }
    );
  }
}

// DELETE /api/users/profile-picture - Remove profile picture
export async function DELETE() {
  try {
    // Check if Supabase is configured
    if (!isSupabaseConfigured() || !supabase) {
      return NextResponse.json(
        { error: "Profile picture uploads are not configured" },
        { status: 503 }
      );
    }

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { image: true },
    });

    if (user?.image?.includes("supabase")) {
      const path = user.image.split("/profile-pictures/")[1];
      if (path) {
        await supabase.storage.from("profile-pictures").remove([path]);
      }
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { image: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[profile-picture] Delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete profile picture" },
      { status: 500 }
    );
  }
}
