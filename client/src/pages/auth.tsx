import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SiCloudflare } from "react-icons/si";

export default function AuthPage() {
  const isDevelopment = process.env.NODE_ENV === 'development';

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <div className="flex items-center gap-2">
            <SiCloudflare className="h-6 w-6 text-[#F38020]" />
            <CardTitle>Authentication Required</CardTitle>
          </div>
          <CardDescription>
            {isDevelopment ? (
              "Development mode: Using test user authentication"
            ) : (
              "Please authenticate using Cloudflare Access"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="prose dark:prose-invert">
          {isDevelopment ? (
            <p>
              In development mode, you are automatically authenticated as a test user.
              If you're seeing this page, the authentication system might not be working correctly.
            </p>
          ) : (
            <>
              <p>
                This application is protected by Cloudflare Access. You need to authenticate
                through your organization's Cloudflare Access portal to use this application.
              </p>
              <p>
                If you're seeing this page:
              </p>
              <ul>
                <li>You may need to log in to your Cloudflare Access portal</li>
                <li>Your session may have expired</li>
                <li>You may not have permission to access this application</li>
              </ul>
              <p>
                Please contact your administrator if you believe you should have access
                to this application.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
