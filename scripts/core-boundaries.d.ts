export interface BoundaryViolation {
  filePath: string;
  specifier: string;
  message: string;
}

export function checkCoreBoundaries(): Promise<BoundaryViolation[]>;
