// Minimal shim so TS stops complaining; runtime is fine.
declare module "leaflet-shadow-simulator" {
    const ShadeMapLeaflet: any;
    export default ShadeMapLeaflet;
}
