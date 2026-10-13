export type AcquiredMidi = {
    title: string;
    buffer: Buffer;
    sourceUrl?: string;
};

export type AcquisitionService = {
    acquire(source: string): Promise<AcquiredMidi>;
};
