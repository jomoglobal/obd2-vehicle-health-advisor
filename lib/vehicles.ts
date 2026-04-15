export type FuelSystem = "MAF" | "MAP";
export type BankCount = 1 | 2;

export interface VehicleConfig {
  id: string;
  make: string;
  model: string;
  year: number;
  engine: string;
  turbocharged: boolean;
  bankCount: BankCount;
  fuelSystem: FuelSystem;
  hasEGR: boolean;
  knownQuirks: string[];
  expectedPIDs: string[];
}

export const vehicles: VehicleConfig[] = [
  {
    id: "tundra-2007",
    make: "Toyota",
    model: "Tundra",
    year: 2007,
    engine: "5.7L V8 (2UR-FSE)",
    turbocharged: false,
    bankCount: 2,
    fuelSystem: "MAF",
    hasEGR: false,
    knownQuirks: [
      "Secondary air injection pump common failure after 100k miles",
      "Bank 2 O2 sensor wiring prone to heat damage near exhaust manifold",
      "EVAP system leak codes triggered by aftermarket gas caps",
    ],
    expectedPIDs: [
      "0104", // Calculated engine load
      "0105", // ECT
      "010B", // Intake manifold pressure
      "010C", // RPM
      "010D", // Vehicle speed
      "010F", // Intake air temperature
      "0110", // MAF air flow rate
      "0111", // Throttle position
      "0114", // O2 Sensor B1S1
      "0115", // O2 Sensor B1S2
      "011B", // O2 Sensor B2S1
      "011C", // O2 Sensor B2S2
      "0106", // STFT B1
      "0107", // LTFT B1
      "0108", // STFT B2
      "0109", // LTFT B2
    ],
  },
  {
    id: "bmw-335i-2009",
    make: "BMW",
    model: "335i",
    year: 2009,
    engine: "3.0L N54 Twin-Turbo I6",
    turbocharged: true,
    bankCount: 2,
    fuelSystem: "MAF",
    hasEGR: false,
    knownQuirks: [
      "STFT/LTFT values reported on generic OBD2 profile are scaled differently than native BMW protocol — add ~2% correction factor",
      "High-pressure fuel pump (HPFP) failure common; watch for P0087 and lean codes",
      "Wastegate rattle at cold start; not a fault condition",
      "Charge pipe blowout under boost; causes sudden lean condition",
      "Injector carbon buildup on GDI system — no port wash; requires walnut blasting",
    ],
    expectedPIDs: [
      "0104", // Calculated engine load
      "0105", // ECT
      "010B", // Intake manifold pressure
      "010C", // RPM
      "010D", // Vehicle speed
      "010F", // Intake air temperature
      "0110", // MAF air flow rate
      "0111", // Throttle position
      "0114", // O2 Sensor B1S1
      "0115", // O2 Sensor B1S2
      "011B", // O2 Sensor B2S1
      "011C", // O2 Sensor B2S2
      "0106", // STFT B1
      "0107", // LTFT B1
      "0108", // STFT B2
      "0109", // LTFT B2
      "010A", // Fuel pressure (relative)
      "0133", // Absolute Barometric Pressure
    ],
  },
  {
    id: "honda-fit-2015",
    make: "Honda",
    model: "Fit",
    year: 2015,
    engine: "1.5L L15B7 VTEC i4",
    turbocharged: false,
    bankCount: 1,
    fuelSystem: "MAP",
    hasEGR: true,
    knownQuirks: [
      "Honda uses a proprietary OBD2 profile; some generic scanners misread MAP sensor values",
      "EGR valve sticky at low mileage intervals — monitor P0400 family codes",
      "CVT heat sensitivity above 230°F; worth logging ATF temp if available",
      "Port injection allows O2 sensor fuel trim feedback on B1 only",
    ],
    expectedPIDs: [
      "0104", // Calculated engine load
      "0105", // ECT
      "010B", // Intake manifold pressure (MAP)
      "010C", // RPM
      "010D", // Vehicle speed
      "010F", // Intake air temperature
      "0111", // Throttle position
      "0114", // O2 Sensor B1S1
      "0115", // O2 Sensor B1S2
      "0106", // STFT B1
      "0107", // LTFT B1
      "012C", // Commanded EGR
      "012D", // EGR Error
    ],
  },
];

export function getVehicleById(id: string): VehicleConfig | undefined {
  return vehicles.find((v) => v.id === id);
}
