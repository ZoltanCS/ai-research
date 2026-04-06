import { AuthGuard } from "@/components/AuthGuard";
import ProfilePage from "@/components/profile/ProfilePage";

export default function Profile() {
  return (
    <AuthGuard>
      <ProfilePage />
    </AuthGuard>
  );
}
