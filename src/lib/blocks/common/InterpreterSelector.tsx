import React, { useState, useEffect, useCallback } from "react";
import { Select, SelectItem, SelectSection, Input, Button } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { PlusIcon, Pencil as PencilIcon, X as XIcon } from "lucide-react";
import { Settings } from "@/state/settings.ts";

// Lightweight runtime OS check
const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent || "");

// Supported shells with their possible paths
export const supportedShells = [
  // Unix-like defaults
  { name: "bash", paths: ["/bin/bash"], defaultArgs: "-lc", sshArgs: "-l" },
  { name: "zsh", paths: ["/bin/zsh"], defaultArgs: "-lc", sshArgs: "-l" },
  { name: "fish", paths: ["/usr/bin/fish", "/usr/local/bin/fish", "/opt/homebrew/bin/fish"], defaultArgs: "-c", sshArgs: "" },
  { name: "python3", paths: ["/usr/bin/python3", "/usr/local/bin/python3"], defaultArgs: "-c", sshArgs: "" },
  { name: "node", paths: ["/usr/bin/node", "/usr/local/bin/node"], defaultArgs: "-e", sshArgs: "" },
  { name: "sh", paths: ["/bin/sh"], defaultArgs: "-ic", sshArgs: "-i" },
  // Windows shells (listed always; availability checks below are OS-aware)
  { name: "powershell", paths: ["C:\\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"], defaultArgs: "-NoProfile -ExecutionPolicy Bypass -Command", sshArgs: "-NoProfile -ExecutionPolicy Bypass -Command" },
  { name: "pwsh", paths: ["C:\\\Program Files\\PowerShell\\7\\pwsh.exe", "C:\\\Program Files (x86)\\PowerShell\\7\\pwsh.exe"], defaultArgs: "-NoProfile -ExecutionPolicy Bypass -Command", sshArgs: "-NoProfile -ExecutionPolicy Bypass -Command" },
  { name: "cmd", paths: ["C:\\\Windows\\System32\\cmd.exe"], defaultArgs: "/S /C", sshArgs: "/S /C" },
];

// Helper to build interpreter command string
export const buildInterpreterCommand = (interpreterName: string, isSSH = false) => {
  // Find the shell configuration (by canonical name or exe name)
  const nameLower = (interpreterName || "").toLowerCase();
  const normalizedName = nameLower.endsWith(".exe") ? nameLower.replace(/\.exe$/, "") : nameLower;
  const shellConfig = supportedShells.find(s => s.name.toLowerCase() === normalizedName);

  // Windows behavior: never prefix with /usr/bin/env; use well-known tools directly
  if (isWindows) {
    if (shellConfig) {
      const args = isSSH ? shellConfig.sshArgs : shellConfig.defaultArgs;
      // Prefer the canonical tool name; absolute path not necessary for powershell/cmd, pwsh assumed on PATH if installed
      return `${shellConfig.name}${args ? " " + args : ""}`.trim();
    }
    // Unknown interpreter on Windows: pass as-is (no env prefix)
    return interpreterName;
  }

  // Unix-like behavior
  if (shellConfig) {
    const args = isSSH ? shellConfig.sshArgs : shellConfig.defaultArgs;
    if (shellConfig.paths[0].startsWith("/bin/")) {
      // Use absolute path for system shells
      return `${shellConfig.paths[0]}${args ? " " + args : ""}`.trim();
    }
    // Use env for other shells so they resolve via PATH
    return `/usr/bin/env ${shellConfig.name}${args ? " " + args : ""}`.trim();
  }

  // Fallback for unknown shells on Unix-like systems
  return `/usr/bin/env ${interpreterName}`;
};

interface InterpreterSelectorProps {
  interpreter: string;
  onInterpreterChange: (interpreter: string) => void;
  size?: "sm" | "md" | "lg";
  variant?: "flat" | "bordered" | "underlined" | "faded";
  isSSH?: boolean;
}

const InterpreterSelector: React.FC<InterpreterSelectorProps> = ({
  interpreter,
  onInterpreterChange,
  size = "sm",
  variant = "flat",
}) => {
  // Track available shells and custom interpreters
  const [availableShells, setAvailableShells] = useState<Record<string, boolean>>({});
  const [isShellMissing, setIsShellMissing] = useState(false);
  const [isCustom, setIsCustom] = useState(!supportedShells.some(shell => shell.name === interpreter));
  const [customValue, setCustomValue] = useState(isCustom ? interpreter : "");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [scriptInterpreters, setScriptInterpreters] = useState<Array<{command: string; name: string}>>([]);

  useEffect(() => {
    // Update isCustom state once scriptInterpreters are loaded
    const isInterpreterSupported = supportedShells.some(shell => shell.name === interpreter) || 
      scriptInterpreters.some(shell => shell.name === interpreter);
    
    setIsCustom(!isInterpreterSupported);
  }, [interpreter, scriptInterpreters, supportedShells]);

  // Function to load script interpreters from settings
  const loadScriptInterpreters = useCallback(async () => {
    try {
      const interpreters = await Settings.scriptInterpreters();
      setScriptInterpreters(interpreters);
    } catch (error) {
      console.error("Failed to load script interpreters:", error);
    }
  }, []);

  // Load script interpreters from settings on mount
  useEffect(() => {
    loadScriptInterpreters();
  }, [loadScriptInterpreters]);

  // Check which shells are installed
  useEffect(() => {
    const checkShellsAvailable = async () => {
      try {
        const shellStatus: Record<string, boolean> = {};

        // Check each supported shell
        for (const shell of supportedShells) {
          // Skip bash and sh as they're always available
          if (shell.name === "bash" || shell.name === "sh") {
            shellStatus[shell.name] = true;
            continue;
          }

          // On Windows, treat core shells as available
          if (isWindows && (shell.name === "powershell" || shell.name === "cmd")) {
            shellStatus[shell.name] = true;
            continue;
          }

          // Check each possible path for this shell
          let found = false;
          for (const path of shell.paths) {
            try {
              const exists = await invoke<boolean>("check_binary_exists", { path });
              if (exists) {
                found = true;
                break;
              }
            } catch (e) {
              console.error(`Error checking ${path}:`, e);
            }
          }

          shellStatus[shell.name] = found;
        }

        setAvailableShells(shellStatus);

        // Check if currently selected shell is available
        if (interpreter !== "bash" && interpreter !== "sh") {
          setIsShellMissing(interpreter in shellStatus && !shellStatus[interpreter]);
        } else {
          setIsShellMissing(false);
        }
      } catch (error) {
        console.error("Failed to check available shells:", error);
      }
    };

    checkShellsAvailable();
  }, [interpreter]);

  // Function to add a custom interpreter
  const handleAddCustom = useCallback(() => {
    if (customValue.trim() === '') return;
    setIsCustom(true);
    onInterpreterChange(customValue);
    setShowCustomInput(false);
  }, [customValue, onInterpreterChange]);
  
  // Handle editing current custom value
  const handleEditCustom = useCallback(() => {
    setCustomValue(interpreter);
    setShowCustomInput(true);
  }, [interpreter]);

  return (
    <>
      {showCustomInput ? (
        <div className="inline-flex items-center gap-2 min-w-[300px]">
          <Input
            size="sm"
            variant="flat"
            placeholder="/bin/bash -c"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            autoFocus
          />
          <Button size="sm" onPress={handleAddCustom} isIconOnly><PlusIcon className="h-3 w-3" /></Button>
          <Button size="sm" variant="light" onPress={() => setShowCustomInput(false)} isIconOnly><XIcon className="h-3 w-3" /></Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-[300px]">
          <Select
            disableAnimation
            size={size}
            variant={variant}
            selectionMode="single"
            popoverProps={{
              classNames: {
                content: "min-w-[300px]"
              }
            }}
            classNames={{
              trigger: "min-h-unit-8 min-w-[180px]",
              base: "min-w-[180px]"
            }}
            selectedKeys={[interpreter]}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                // Refresh interpreters when dropdown opens
                loadScriptInterpreters();
              }
            }}
            onSelectionChange={(e) => {
              if (!e.currentKey) return;
              const key = e.currentKey as string;
              if (key === "_custom") {
                setShowCustomInput(true);
                return;
              }
              setIsCustom(false);
              onInterpreterChange(key);
            }}
            aria-label="Select interpreter"
          >
            {/* Add custom interpreter as first option if we're using one */}
            {isCustom ? (
              <SelectItem 
                key={interpreter} 
                classNames={{ base: "py-1", description: "text-xs opacity-70" }}
                description="Custom interpreter"
              >
                {interpreter}
              </SelectItem>
            ) : null}

            <SelectSection title="System">
              {supportedShells.map(shell => {
                // Always show bash and sh, or any shell that's available, or the current selected shell
                const shouldShow = shell.name === "bash" ||
                  shell.name === "sh" ||
                  availableShells[shell.name] ||
                  interpreter === shell.name;

                return shouldShow ? (
                  <SelectItem 
                    key={shell.name} 
                    aria-label={shell.name}
                    className={interpreter === shell.name && isShellMissing ? "text-red-500" : ""}
                    classNames={{ base: "py-1", description: "text-xs opacity-70" }}
                    description={buildInterpreterCommand(shell.name).replace("/usr/bin/env ", "")}
                  >
                    {shell.name}
                  </SelectItem>
                ) : null;
              })}
            </SelectSection>

            {scriptInterpreters.length > 0 ? (
              <SelectSection title="Saved">
                {scriptInterpreters.map(interpreter => (
                  <SelectItem 
                    key={interpreter.command}
                    classNames={{ base: "py-1", description: "text-xs opacity-70" }}
                    description={interpreter.command}
                  >
                    {interpreter.name}
                  </SelectItem>
                ))}
              </SelectSection>
            ) : null}

            <SelectSection title="Actions">
              <SelectItem
                key="_custom"
                startContent={<PlusIcon className="h-3 w-3" />}
                classNames={{ description: "text-xs opacity-70" }}
                description="Add custom"
              >
                Custom
              </SelectItem>
            </SelectSection>
          </Select>
          
          {isCustom && (
            <Button 
              size="sm" 
              isIconOnly 
              variant="light" 
              className="text-gray-500" 
              onPress={handleEditCustom}
            >
              <PencilIcon className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
    </>
  );
};

export default InterpreterSelector;