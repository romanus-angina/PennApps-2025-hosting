import ShadeClassifier, { Edge } from "./components/Map";
import EdgeAnalysis from "./components/EdgeAnalysis";
import { useMemo, useState, useEffect } from "react";

export default function App() {
  const [date] = useState(() => new Date());
  const edges = useMemo(() => [], []); // No demo edges needed
  const [currentPage, setCurrentPage] = useState<'map' | 'analysis'>(() => {
    // Check URL path to determine initial page
    return window.location.pathname === '/analysis' ? 'analysis' : 'map';
  });

  // Handle URL changes
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(window.location.pathname === '/analysis' ? 'analysis' : 'map');
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Update URL when page changes
  const navigateToPage = (page: 'map' | 'analysis') => {
    const newPath = page === 'analysis' ? '/analysis' : '/';
    window.history.pushState({}, '', newPath);
    setCurrentPage(page);
  };

  if (currentPage === 'analysis') {
    return <EdgeAnalysis onBack={() => navigateToPage('map')} />;
  }

  return (
    <div style={{ height: "100%" }}>
      <ShadeClassifier edges={edges} date={date} onResults={(r) => console.log("edge shades:", r)} />
    </div>
  );
}
