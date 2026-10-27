"use client";
import { createContext } from "react";
export const GuideSignInContext = createContext<{ signIn: (email: string, password: string) => Promise<void>; error: string } | null>(null);
