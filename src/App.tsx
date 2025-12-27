import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import Index from "./pages/Index";
import Chat from "./pages/Chat";
import AdminDashboard from "./pages/AdminDashboard";
import CharacterOnboarding from "./pages/CharacterOnboarding";
import NotFound from "./pages/NotFound";

// Riya Character System (separate from custom companions)
import RiyaLanding from "./pages/riya/RiyaLanding";
import RiyaCallback from "./pages/riya/RiyaCallback";
import RiyaProfileSetup from "./pages/riya/RiyaProfileSetup";
import RiyaChat from "./pages/riya/RiyaChat";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Existing Custom Companion System */}
          <Route path="/" element={<Index />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/character/:characterId" element={<CharacterOnboarding />} />
          <Route path="/admin-dashboard" element={<AdminDashboard />} />

          {/* Riya Character System */}
          <Route path="/riya" element={<RiyaLanding />} />
          <Route path="/riya/callback" element={<RiyaCallback />} />
          <Route path="/riya/onboarding/profile" element={<RiyaProfileSetup />} />
          <Route path="/riya/chat" element={<RiyaChat />} />

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
