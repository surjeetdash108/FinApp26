import { AuthLayout } from "./auth/auth-layout";
import { LoginForm } from "./auth/login/login-form";

export default function Home() {
  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
}
