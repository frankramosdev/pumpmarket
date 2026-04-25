import { App } from "@/components/App";

// This is a server component but our trading UI is fully interactive, so
// all the real work happens in the <App/> client component.
export default function Page() {
  return <App />;
}
