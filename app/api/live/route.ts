import { bus, type LiveEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

const MAX_CLIENTS = 500;
let clients = 0;

export async function GET(request: Request) {
  if (clients >= MAX_CLIENTS) return new Response('Too many listeners', { status: 503 });
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clients++;
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onEvent = (e: LiveEvent) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      const ping = setInterval(() => send(': ping\n\n'), 25_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clients--;
        clearInterval(ping);
        bus.off('event', onEvent);
        try {
          controller.close();
        } catch {}
      };
      bus.on('event', onEvent);
      request.signal.addEventListener('abort', cleanup);
      send('retry: 5000\n\n');
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
