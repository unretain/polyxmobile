// NFC Service - Wrapper for Capacitor NFC plugin
import { Capacitor } from "@capacitor/core";
import type { NdefRecord, NfcEvent } from "@capgo/capacitor-nfc";
import { ColdStickPayload, parseNfcPayload } from "./coldstick";

// TNF and type bytes for an NDEF well-known text record ("T")
const TNF_WELL_KNOWN = 1;
const TYPE_TEXT = [0x54];

// Build an NDEF text record: [status byte][lang code][utf-8 text]
function createTextRecord(text: string, lang = "en"): NdefRecord {
  const langBytes = Array.from(new TextEncoder().encode(lang));
  const textBytes = Array.from(new TextEncoder().encode(text));
  return {
    tnf: TNF_WELL_KNOWN,
    type: TYPE_TEXT,
    id: [],
    payload: [langBytes.length, ...langBytes, ...textBytes],
  };
}

// Decode an NDEF text record payload, stripping the status byte and lang code
function decodeTextRecord(payload: number[]): string {
  const langCodeLength = payload[0] & 0x3f;
  const textBytes = Uint8Array.from(payload.slice(1 + langCodeLength));
  return new TextDecoder().decode(textBytes);
}

// Check if NFC is available on this device
export async function isNfcAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const { CapacitorNfc } = await import("@capgo/capacitor-nfc");
    const { status } = await CapacitorNfc.getStatus();
    return status === "NFC_OK";
  } catch (error) {
    console.error("NFC check failed:", error);
    return false;
  }
}

// Start NFC scan session
export async function startNfcScan(
  onTagRead: (payload: ColdStickPayload | null, rawData: string) => void,
  onError: (error: string) => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    onError("NFC is only available on native devices");
    return () => {};
  }

  try {
    const { CapacitorNfc } = await import("@capgo/capacitor-nfc");

    // Clear any stale listeners first — otherwise a leftover read/write listener
    // fires on the same nfcEvent and reports a false "no NDEF message".
    await (CapacitorNfc as any).removeAllListeners();

    const listener = await CapacitorNfc.addListener("nfcEvent", (event: NfcEvent) => {
      try {
        const records = event.tag.ndefMessage;
        if (records && records.length > 0) {
          const text = decodeTextRecord(records[0].payload);
          onTagRead(parseNfcPayload(text), text);
        } else {
          onTagRead(null, "");
        }
      } catch (err) {
        console.error("Error parsing NFC tag:", err);
        onError("Failed to read NFC tag data");
      }
    });

    await CapacitorNfc.startScanning({
      alertMessage: "Hold your ColdStick near the top of your phone",
    });

    return async () => {
      await listener.remove();
      await CapacitorNfc.stopScanning();
    };
  } catch (error: any) {
    onError(error.message || "Failed to start NFC scan");
    return () => {};
  }
}

// Write data to NFC tag
export async function writeNfcTag(
  payload: ColdStickPayload,
  onSuccess: () => void,
  onError: (error: string) => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    onError("NFC is only available on native devices");
    return () => {};
  }

  try {
    const { CapacitorNfc } = await import("@capgo/capacitor-nfc");

    const record = createTextRecord(JSON.stringify(payload));

    // Clear stale listeners so a leftover read-listener can't fire a false
    // "no NDEF message" while we're writing.
    await (CapacitorNfc as any).removeAllListeners();

    // The tag must be discovered before it can be written to
    const listener = await CapacitorNfc.addListener("nfcEvent", async () => {
      try {
        await CapacitorNfc.write({ records: [record] });
        onSuccess();
        await CapacitorNfc.stopScanning();
      } catch (err: any) {
        console.error("Error writing NFC tag:", err);
        onError(err.message || "Failed to write to NFC tag");
      }
    });

    // NDEF session (needs only the NDEF entitlement, which is present). Keeps the
    // session open (invalidateAfterFirstRead:false) so we can write. NOTE: the
    // plugin's NDEF path bails on a *blank* sticker — so the sticker must already
    // hold an NDEF message (pre-format it once, then this overwrites it).
    await CapacitorNfc.startScanning({
      alertMessage: "Hold your NFC sticker near the top of your phone to write",
      invalidateAfterFirstRead: false,
    } as any);

    return async () => {
      await listener.remove();
      await CapacitorNfc.stopScanning();
    };
  } catch (error: any) {
    onError(error.message || "Failed to start NFC write session");
    return () => {};
  }
}

// Make NFC tag read-only (optional security feature)
export async function lockNfcTag(
  onSuccess: () => void,
  onError: (error: string) => void
): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    onError("NFC is only available on native devices");
    return;
  }

  try {
    const { CapacitorNfc } = await import("@capgo/capacitor-nfc");

    // Note: This makes the tag permanently read-only!
    await CapacitorNfc.makeReadOnly();
    onSuccess();
  } catch (error: any) {
    onError(error.message || "Failed to lock NFC tag");
  }
}
