import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4", "video/quicktime"],
        addRandomSuffix: true,
        maximumSizeInBytes: 30 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {
        // Nada que hacer aquí — el cliente dispara /api/edit explícitamente
        // una vez confirma la subida.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
