import ShadeClassifier, { Edge } from "./components/Map";
import { useMemo, useState } from "react";

const demoEdges: Edge[] = [
  { id: "e1", a: { lat: 39.94988, lng: -75.17132 }, b: { lat: 39.95195, lng: -75.16530 } },
  { id: "e2", a: { lat: 39.94910, lng: -75.16900 }, b: { lat: 39.95390, lng: -75.16380 } },
];

export default function App() {
  const [date] = useState(() => new Date());
  const edges = useMemo(() => demoEdges, []);
  return (
    <div style={{ height: "100%" }}>
      <ShadeClassifier edges={edges} date={date} onResults={(r) => console.log("edge shades:", r)} />
    </div>
  );
}
