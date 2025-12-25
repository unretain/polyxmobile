/**
 * Set up Supabase Storage bucket for profile pictures
 * Run with: npx tsx scripts/setup-storage.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Load .env.local
config({ path: ".env.local" });

// Use service role key for admin operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.log("\nYou need to add these to your .env.local:");
  console.log("NEXT_PUBLIC_SUPABASE_URL=https://jbnfarakhztukmwslovd.supabase.co");
  console.log("SUPABASE_SERVICE_ROLE_KEY=<your service role key from Supabase dashboard>");
  console.log("\nFind it at: Supabase Dashboard > Settings > API > service_role key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

async function setupStorage() {
  console.log("Setting up Supabase Storage for profile pictures...\n");

  // Check if bucket exists
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error("Failed to list buckets:", listError.message);
    process.exit(1);
  }

  const bucketExists = buckets?.some(b => b.name === "profile-pictures");

  if (bucketExists) {
    console.log("✓ Bucket 'profile-pictures' already exists");
  } else {
    // Create the bucket
    const { error: createError } = await supabase.storage.createBucket("profile-pictures", {
      public: true, // Allow public read access
      fileSizeLimit: 5 * 1024 * 1024, // 5MB limit
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"]
    });

    if (createError) {
      console.error("Failed to create bucket:", createError.message);
      process.exit(1);
    }

    console.log("✓ Created bucket 'profile-pictures'");
  }

  console.log("\n✅ Storage setup complete!");
  console.log("\nMake sure you have these in your .env.local:");
  console.log(`NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`);
  console.log("NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key>");
}

setupStorage().catch(console.error);
