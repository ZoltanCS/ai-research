import { Suspense } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";

// useSearchParams() inside ChatInterface requires a Suspense boundary in Next.js 14
export default function ChatPage() {
  return (
    <Suspense>
      <ChatInterface />
    </Suspense>
  );
}
