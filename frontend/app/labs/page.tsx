import AuthGuard from "@/components/AuthGuard";
import LabsPage from "@/components/labs/LabsPage";

export default function Labs() {
  return (
    <AuthGuard>
      <LabsPage />
    </AuthGuard>
  );
}
