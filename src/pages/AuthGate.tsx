import { useEffect, useMemo, useState } from "react";
import { Lock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requestOtp, verifyOtp, type OtpChannel } from "@/features/auth/api/authClient";

export type AccessMode = "registered" | "guest";

export interface UserSession {
  accessMode: AccessMode;
  channel?: OtpChannel;
  identifier?: string;
  maskedIdentifier?: string;
  token?: string;
  authenticatedAt: string;
}

interface AuthGateProps {
  onAuthenticated: (session: UserSession) => void;
}

function normalizeMobileInput(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [channel, setChannel] = useState<OtpChannel>("mobile");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [maskedIdentifier, setMaskedIdentifier] = useState("");
  const [demoOtp, setDemoOtp] = useState("");
  const [helperMessage, setHelperMessage] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    setIdentifier("");
    setOtp("");
    setOtpSent(false);
    setMaskedIdentifier("");
    setDemoOtp("");
    setHelperMessage("");
    setError("");
  }, [channel]);

  const normalizedIdentifier = useMemo(() => {
    const value = identifier.trim();
    if (channel === "mobile") {
      return normalizeMobileInput(value);
    }
    return value.toLowerCase();
  }, [channel, identifier]);

  async function handleSendOtp() {
    if (!normalizedIdentifier) {
      setError(channel === "mobile" ? "Enter your mobile number." : "Enter your email address.");
      return;
    }

    setError("");
    setIsSending(true);
    try {
      const response = await requestOtp({
        channel,
        identifier: normalizedIdentifier,
      });
      setOtpSent(true);
      setMaskedIdentifier(response.masked_identifier);
      setHelperMessage(response.message);
      setDemoOtp(response.demo_otp || "");
      setOtp("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send OTP.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otp.trim()) {
      setError("Enter the OTP.");
      return;
    }

    setError("");
    setIsVerifying(true);
    try {
      const response = await verifyOtp({
        channel,
        identifier: normalizedIdentifier,
        otp: otp.trim(),
      });

      onAuthenticated({
        accessMode: "registered",
        channel: response.user.channel,
        identifier: response.user.identifier,
        maskedIdentifier: response.user.masked_identifier,
        token: response.token,
        authenticatedAt: response.verified_at,
      });
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Could not verify OTP.");
    } finally {
      setIsVerifying(false);
    }
  }

  function continueAsGuest() {
    onAuthenticated({
      accessMode: "guest",
      authenticatedAt: new Date().toISOString(),
    });
  }

  return (
    <main className="h-[100dvh] bg-slate-100 px-3 py-3">
      <div className="mx-auto w-full max-w-[430px]">
        <Card className="flex h-[calc(100dvh-1.5rem)] flex-col rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.55)]">
          <div className="space-y-2">
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Groww AI</Badge>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
              <Sparkles className="size-5 text-emerald-600" />
              Continue to Filing Research
            </h1>
            <p className="text-sm text-slate-600">
              Register with mobile/email + OTP, or continue in guest mode.
            </p>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <Tabs value={channel} onValueChange={(value) => setChannel(value as OtpChannel)}>
              <TabsList className="grid h-10 w-full grid-cols-2">
                <TabsTrigger value="mobile" className="text-xs">
                  Mobile
                </TabsTrigger>
                <TabsTrigger value="email" className="text-xs">
                  Email
                </TabsTrigger>
              </TabsList>

              <TabsContent value="mobile" className="space-y-2">
                <Label htmlFor="mobile-input" className="text-xs text-slate-600">
                  Mobile number
                </Label>
                <Input
                  id="mobile-input"
                  value={identifier}
                  onChange={(event) => setIdentifier(normalizeMobileInput(event.target.value))}
                  placeholder="+91XXXXXXXXXX"
                  className="h-10 bg-white"
                />
              </TabsContent>

              <TabsContent value="email" className="space-y-2">
                <Label htmlFor="email-input" className="text-xs text-slate-600">
                  Email address
                </Label>
                <Input
                  id="email-input"
                  type="email"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="you@example.com"
                  className="h-10 bg-white"
                />
              </TabsContent>
            </Tabs>

            {otpSent ? (
              <div className="mt-3 space-y-2">
                <Label htmlFor="otp-input" className="text-xs text-slate-600">
                  OTP {maskedIdentifier ? `for ${maskedIdentifier}` : ""}
                </Label>
                <Input
                  id="otp-input"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                  placeholder="6-digit OTP"
                  className="h-10 bg-white"
                />
              </div>
            ) : null}

            {helperMessage ? <p className="mt-2 text-xs text-slate-600">{helperMessage}</p> : null}
            {demoOtp ? (
              <p className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                Demo OTP: {demoOtp}
              </p>
            ) : null}
            {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}

            <div className="mt-3 flex gap-2">
              {!otpSent ? (
                <Button type="button" className="h-10 flex-1" disabled={isSending} onClick={() => void handleSendOtp()}>
                  {isSending ? "Sending..." : "Send OTP"}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={isSending || isVerifying}
                    onClick={() => void handleSendOtp()}
                  >
                    Resend
                  </Button>
                  <Button
                    type="button"
                    className="h-10 flex-1"
                    disabled={isVerifying}
                    onClick={() => void handleVerifyOtp()}
                  >
                    {isVerifying ? "Verifying..." : "Verify OTP"}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="mt-auto space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p className="font-medium text-slate-700">Guest mode limit</p>
              <p className="mt-1">Guest users can search only 3 companies.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full border-slate-300 text-slate-700"
              onClick={continueAsGuest}
            >
              <Lock className="mr-2 size-4" />
              Continue as Guest
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
