"use client";

// Streams the assembled WebM straight from the serving route — no client-side blob
// assembly needed; the browser plays the video/webm response directly.
export function VideoRecordingPlayer({ id }: { id: string }) {
  return (
    <video
      controls
      src={`/api/admin/recordings/${id}/video`}
      style={{ width: "100%", maxHeight: "70vh", background: "#000" }}
    />
  );
}
