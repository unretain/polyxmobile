"use client";

import { useRef, useEffect, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface FlyControlsProps {
  enabled: boolean;
  movementSpeed?: number;
  lookSpeed?: number;
  onExit?: () => void;
}

/**
 * FlyControls - First-person flying camera controls for 3D chart exploration
 *
 * Controls:
 * - W/S: Move forward/backward
 * - A/D: Strafe left/right
 * - Q/E: Move down/up
 * - Mouse: Look around (when pointer locked)
 * - ESC: Exit fly mode
 * - Space: Move up faster
 * - Shift: Move down faster
 */
export function FlyControls({
  enabled,
  movementSpeed = 15,
  lookSpeed = 0.002,
  onExit,
}: FlyControlsProps) {
  const { camera, gl } = useThree();

  // Movement state
  const moveState = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    speedUp: false,
  });

  // Mouse state for looking
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const isPointerLocked = useRef(false);

  // Store initial camera state to restore on exit
  const initialState = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  } | null>(null);

  // Initialize euler from camera rotation
  useEffect(() => {
    if (enabled) {
      euler.current.setFromQuaternion(camera.quaternion);
      // Store initial state
      if (!initialState.current) {
        initialState.current = {
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone(),
        };
      }
    }
  }, [enabled, camera]);

  // Handle keyboard input
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Prevent default for movement keys to avoid scrolling
    if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Space"].includes(event.code)) {
      event.preventDefault();
    }

    switch (event.code) {
      case "KeyW":
        moveState.current.forward = true;
        break;
      case "KeyS":
        moveState.current.backward = true;
        break;
      case "KeyA":
        moveState.current.left = true;
        break;
      case "KeyD":
        moveState.current.right = true;
        break;
      case "KeyQ":
        moveState.current.down = true;
        break;
      case "KeyE":
      case "Space":
        moveState.current.up = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        moveState.current.speedUp = true;
        break;
      case "Escape":
        // Exit fly mode
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
        onExit?.();
        break;
    }
  }, [enabled, onExit]);

  const onKeyUp = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    switch (event.code) {
      case "KeyW":
        moveState.current.forward = false;
        break;
      case "KeyS":
        moveState.current.backward = false;
        break;
      case "KeyA":
        moveState.current.left = false;
        break;
      case "KeyD":
        moveState.current.right = false;
        break;
      case "KeyQ":
        moveState.current.down = false;
        break;
      case "KeyE":
      case "Space":
        moveState.current.up = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        moveState.current.speedUp = false;
        break;
    }
  }, [enabled]);

  // Handle mouse movement for looking
  const onMouseMove = useCallback((event: MouseEvent) => {
    if (!enabled || !isPointerLocked.current) return;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    // Update euler angles (yaw and pitch)
    euler.current.y -= movementX * lookSpeed;
    euler.current.x -= movementY * lookSpeed;

    // Clamp pitch to prevent flipping
    euler.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.current.x));

    // Apply rotation to camera
    camera.quaternion.setFromEuler(euler.current);
  }, [enabled, camera, lookSpeed]);

  // Handle pointer lock change
  const onPointerLockChange = useCallback(() => {
    isPointerLocked.current = document.pointerLockElement === gl.domElement;

    if (!isPointerLocked.current && enabled) {
      // Pointer lock was released, might want to exit fly mode
      // But only if ESC was pressed (not just clicking outside)
    }
  }, [gl.domElement, enabled]);

  // Handle pointer lock error
  const onPointerLockError = useCallback(() => {
    console.error("Pointer lock error - fly mode may not work properly");
  }, []);

  // Request pointer lock on click when fly mode is enabled
  const onClick = useCallback(() => {
    if (enabled && !isPointerLocked.current) {
      gl.domElement.requestPointerLock();
    }
  }, [enabled, gl.domElement]);

  // Set up event listeners
  useEffect(() => {
    if (!enabled) {
      // Reset movement state when disabled
      moveState.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        speedUp: false,
      };

      // Exit pointer lock if active
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
      return;
    }

    // Add event listeners
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("pointerlockerror", onPointerLockError);
    gl.domElement.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("pointerlockerror", onPointerLockError);
      gl.domElement.removeEventListener("click", onClick);

      // Clean up pointer lock
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
    };
  }, [enabled, gl.domElement, onKeyDown, onKeyUp, onMouseMove, onPointerLockChange, onPointerLockError, onClick]);

  // Update camera position each frame
  useFrame((_, delta) => {
    if (!enabled) return;

    const speed = moveState.current.speedUp ? movementSpeed * 2.5 : movementSpeed;
    const moveDistance = speed * delta;

    // Get camera direction vectors
    const direction = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    // Forward/backward (along camera's forward axis, but on XZ plane for more intuitive movement)
    camera.getWorldDirection(direction);

    // Right vector (perpendicular to forward on XZ plane)
    right.crossVectors(direction, up).normalize();

    // Movement vector
    const movement = new THREE.Vector3();

    if (moveState.current.forward) {
      movement.add(direction.clone().multiplyScalar(moveDistance));
    }
    if (moveState.current.backward) {
      movement.add(direction.clone().multiplyScalar(-moveDistance));
    }
    if (moveState.current.left) {
      movement.add(right.clone().multiplyScalar(-moveDistance));
    }
    if (moveState.current.right) {
      movement.add(right.clone().multiplyScalar(moveDistance));
    }
    if (moveState.current.up) {
      movement.y += moveDistance;
    }
    if (moveState.current.down) {
      movement.y -= moveDistance;
    }

    // Apply movement
    camera.position.add(movement);
  });

  return null;
}
