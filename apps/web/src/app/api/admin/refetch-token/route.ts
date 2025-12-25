import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

const MORALIS_API_URL = "https://solana-gateway.moralis.io";

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();

    if (!address) {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    // Delete from Token table
    await prisma.token.deleteMany({
      where: { address },
    });

    // Delete from PulseToken table
    await prisma.pulseToken.deleteMany({
      where: { address },
    });

    console.log(`Deleted token ${address} from cache`);

    // Refetch from Moralis
    if (config.moralisApiKey) {
      const res = await fetch(
        `${MORALIS_API_URL}/token/mainnet/${address}/metadata`,
        {
          headers: {
            accept: "application/json",
            "X-API-Key": config.moralisApiKey,
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        console.log("Moralis response:", data);

        if (data) {
          // Save to Token table
          await prisma.token.create({
            data: {
              address,
              name: data.name || data.symbol || address.slice(0, 8),
              symbol: data.symbol || address.slice(0, 6),
              decimals: parseInt(data.decimals || "6"),
              logoUri: data.logo || null,
            },
          });

          return NextResponse.json({
            success: true,
            token: {
              address,
              name: data.name,
              symbol: data.symbol,
              logo: data.logo,
            },
          });
        }
      } else {
        const error = await res.text();
        console.error("Moralis error:", error);
        return NextResponse.json({ error: "Moralis fetch failed", details: error }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, message: "Deleted but no Moralis key to refetch" });
  } catch (error) {
    console.error("Refetch token error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
