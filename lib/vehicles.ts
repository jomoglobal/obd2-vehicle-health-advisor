export type FuelSystem = "MAF" | "MAP";
export type FuelType = "gasoline" | "flex-fuel";
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
  fuelType: FuelType;
  hasEGR: boolean;
  knownQuirks: string[];
  expectedPIDs: string[];
  // PIDs that are known to be inaccessible on this vehicle via generic OBD2
  inaccessiblePIDs?: string[];
}

export const vehicles: VehicleConfig[] = [
  {
    id: "tundra-2007",
    make: "Toyota",
    model: "Tundra",
    year: 2007,
    engine: "4.0L V6 (1GR-FE)",
    turbocharged: false,
    bankCount: 2,
    fuelSystem: "MAF",
    fuelType: "gasoline",
    hasEGR: false,
    knownQuirks: [
      "Secondary air injection pump common failure after 100k miles",
      "Bank 2 O2 sensor wiring prone to heat damage near exhaust manifold",
      "EVAP system leak codes triggered by aftermarket gas caps",
      "Generic OBD2 scanners (ELM327) often fail to log MAF, upstream O2, and STFT B2 on this vehicle — missing PIDs are a tool limitation, not necessarily a sensor fault",
    ],
    inaccessiblePIDs: [
      "0110", // MAF — frequently unreported by ELM327 on 1GR-FE
      "0108", // STFT B2 — often missing from generic OBD2 captures on this engine
      "0114", // O2 B1S1 — upstream O2 sensors not reliably reported via generic OBD2
      "011B", // O2 B2S1 — same
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
    fuelType: "flex-fuel",
    hasEGR: false,
    knownQuirks: [
      "HPFP (high-pressure fuel pump) failure is one of the most common N54 faults — symptoms are lean codes (P0087, P2177, P2179), stalling under boost, and rough running at high load; rail pressure drop under WOT is the key diagnostic signal",
      "HPFP low-pressure feed must be 65–75 PSI at idle and hold under boost; if low-pressure drops below 55 PSI under load, the HPFP cannot build adequate rail pressure regardless of pump condition",
      "Runs flex fuel — ethanol content changes every fill-up; AFR targets, fuel trims, and timing advance all shift with ethanol content; always note ethanol % when interpreting fuel trim data",
      "At high ethanol blends (E50+), STFT/LTFT will read persistently negative (rich correction) on a non-ethanol-compensating tune — this is expected, not a fault",
      "STFT/LTFT values reported on generic OBD2 profile are scaled differently than native BMW protocol — add ~2% correction factor when comparing to MHD or NCS logs",
      "Wastegate rattle at cold start is a known benign N54 characteristic — not a fault condition",
      "Charge pipe blowout under boost causes sudden lean spike followed by boost loss; look for STFT max spike >20% with simultaneous boost pressure drop",
      "Injector carbon buildup on GDI system — no port wash; intake valves accumulate carbon over time; symptoms are lean idle trims that normalize under load; requires walnut blasting every 40–60k miles",
      "Per-cylinder timing knock retard (visible via MHD) is more diagnostic than aggregate STFT — a single cylinder pulling timing while others are normal points to an injector or compression issue on that cylinder",
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
    fuelType: "gasoline",
    hasEGR: true,
    inaccessiblePIDs: [
      "010D", // Vehicle speed — Honda Fit does not expose via generic OBD2; returns 0
    ],
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
