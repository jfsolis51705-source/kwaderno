import { LoadingState } from "@/components/app/states";

/** `/` is redirected by src/proxy.ts (to /dashboard or /login); this only renders if that is bypassed. */
export default function Home() {
  return <LoadingState className="m-10" />;
}
