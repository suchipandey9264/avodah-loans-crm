import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep a page's last data for 30 min (default 5): revisiting shows it at once and refreshes in the background
      // instead of a full-page spinner while the API reaches the database. Signing out clears it (lib/auth.jsx).
      gcTime: 30 * 60_000,
      // Don't retry auth/permission/validation failures; do retry flaky network errors once.
      retry: (count, err) => count < 1 && (!err.status || err.status >= 500),
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
