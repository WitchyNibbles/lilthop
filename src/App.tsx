import { AppProvider } from "./app/AppProvider";
import { Shell } from "./shell/Shell";

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
