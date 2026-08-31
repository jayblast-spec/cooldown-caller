import Dashboard from "@/components/Dashboard";
import MarketingHero from "@/components/MarketingHero";
import { OnboardingTour } from "@/components/OnboardingTour";

export default function Home() {
  return (
    <>
      <MarketingHero />
      <Dashboard />
      <OnboardingTour />
    </>
  );
}
