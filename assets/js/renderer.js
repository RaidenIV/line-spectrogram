(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { THREE, elements, state, camera, renderer, controls, scene } = App.core;
  const { CONSTANTS } = App.config;
  const { BASELINE_VIEWPORT_ASPECT, BASELINE_CAMERA_VERTICAL_FOV } = CONSTANTS;

  const cameraDirection = new THREE.Vector3();
  let rendererWidth = 0;
  let rendererHeight = 0;
  let resizeFrame = 0;

  function getFormatAspect(format = state.viewportFormat) {
    if (format === "landscape") return 16 / 9;
    if (format === "square") return 1;
    if (format === "portrait") return 9 / 16;
    return null;
  }

  function fitViewportFrame() {
    const formatAspect = getFormatAspect();
    const frame = elements.viewportFrame;

    if (!formatAspect) {
      frame.classList.remove("is-constrained");
      frame.style.width = "";
      frame.style.height = "";
      frame.style.aspectRatio = "";
      queueResize();
      return;
    }

    const width = Math.max(220, elements.viewport.clientWidth - 36);
    const height = Math.max(220, elements.viewport.clientHeight - 36);
    let frameWidth = Math.min(width, height * formatAspect);
    let frameHeight = frameWidth / formatAspect;

    if (frameHeight > height) {
      frameHeight = height;
      frameWidth = frameHeight * formatAspect;
    }

    frame.classList.add("is-constrained");
    frame.style.aspectRatio = String(formatAspect);
    frame.style.width = `${Math.round(frameWidth)}px`;
    frame.style.height = `${Math.round(frameHeight)}px`;
    queueResize();
  }

  function applyCameraProjection(targetCamera, aspect) {
    const baselineVerticalRadians = THREE.MathUtils.degToRad(BASELINE_CAMERA_VERTICAL_FOV);
    const baselineHorizontalRadians = 2 * Math.atan(
      Math.tan(baselineVerticalRadians / 2) * BASELINE_VIEWPORT_ASPECT,
    );

    targetCamera.aspect = aspect;
    targetCamera.fov = aspect < BASELINE_VIEWPORT_ASPECT
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(baselineHorizontalRadians / 2) / aspect))
      : BASELINE_CAMERA_VERTICAL_FOV;
    targetCamera.updateProjectionMatrix();
  }

  function resizeRenderer() {
    resizeFrame = 0;
    const width = Math.max(1, elements.viewportFrame.clientWidth);
    const height = Math.max(1, elements.viewportFrame.clientHeight);
    if (width === rendererWidth && height === rendererHeight) return;

    rendererWidth = width;
    rendererHeight = height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    applyCameraProjection(camera, width / height);
    App.hud?.resizePreviewCanvas();
  }

  function queueResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(resizeRenderer);
  }

  function updateCameraFromControls() {
    const direction = cameraDirection.subVectors(camera.position, controls.target).normalize();
    const horizontal = Math.sqrt(Math.max(0.001, 1 - direction.y * direction.y));
    const azimuth = Math.atan2(direction.x, direction.z);
    const distance = state.cameraDistance;

    camera.position.set(
      controls.target.x + Math.sin(azimuth) * horizontal * distance,
      state.cameraHeight,
      controls.target.z + Math.cos(azimuth) * horizontal * distance,
    );
    controls.update();
  }

  function renderLive() {
    renderer.render(scene, camera);
  }

  function renderSceneTo(rendererTarget, targetCamera, width, height, synchronize = false) {
    const savedAspect = targetCamera.aspect;
    const savedFov = targetCamera.fov;
    applyCameraProjection(targetCamera, width / height);
    rendererTarget.setSize(width, height, false);
    rendererTarget.render(scene, targetCamera);
    if (synchronize) rendererTarget.getContext().finish();
    targetCamera.aspect = savedAspect;
    targetCamera.fov = savedFov;
    targetCamera.updateProjectionMatrix();
  }

  function setViewportFormat(format) {
    state.viewportFormat = format;
    elements.viewportFormat.value = format;
    fitViewportFrame();
  }

  App.renderer = {
    getFormatAspect,
    fitViewportFrame,
    applyCameraProjection,
    resizeRenderer,
    queueResize,
    updateCameraFromControls,
    renderLive,
    renderSceneTo,
    setViewportFormat,
  };
})();
