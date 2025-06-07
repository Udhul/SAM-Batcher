# SAM2 Canvas System: Technical Specification

**Version:** 1.0  
**Date:** June 1, 2025  
**Parent Document:** specification.md

**Table of Contents:**
1. Introduction and Goals
2. Canvas System Architecture
   2.1. Multi-Layer Canvas Design
   2.2. Component Responsibilities
   2.3. Data Flow and State Management
3. Canvas Layer Specifications
   3.1. Image Display Layer
   3.2. Prediction Mask Layer
   3.3. User Input Layer
4. Mask Visualization System
   4.1. Mask Data Processing
   4.2. Color Generation and Assignment
   4.3. Rendering Pipeline
   4.4. Opacity and Visibility Controls
5. User Interaction System
   5.1. Input Method Specifications
   5.2. Interactive Canvas Controls
   5.3. Coordinate System Management
   5.4. Event Handling and State Updates
6. Mask Management and Selection
   6.1. Prediction Visibility
   6.2. Individual Mask Toggling
   6.3. Multi-Region Mask Handling
   6.4. Selection State Management
7. Backend Integration
   7.1. API Communication Patterns
   7.2. Data Format Specifications
   7.3. State Synchronization
8. Performance and Optimization
   8.1. Rendering Optimizations
   8.2. Memory Management
   8.3. Progressive Loading
9. Error Handling and Edge Cases
10. Future Considerations

---

## 1. Introduction and Goals

This document specifies the canvas system for the SAM2 Image Masking Web Application, defining the interactive visualization and annotation interface that enables users to work with images and AI-generated masks.

**Primary Goals:**
* **Intuitive Visual Interface:** Provide clear, responsive visualization of images, masks, and user inputs
* **Flexible Interaction Model:** Support multiple input methods (points, boxes, polygons) with real-time feedback
* **Efficient Mask Management:** Enable users to easily select, toggle, and refine AI-generated masks
* **Performance Optimization:** Maintain smooth interaction even with large images and complex mask sets
* **Backend Integration:** Seamlessly communicate user interactions and display server responses

**Key Principles:**
* **Separation of Concerns:** Distinct layers for different visual elements
* **Real-time Responsiveness:** Immediate visual feedback for user interactions
* **Data Integrity:** Accurate coordinate mapping between display and original image spaces
* **Accessibility:** Clear visual indicators and intuitive controls

---

## 2. Canvas System Architecture

### 2.1. Multi-Layer Canvas Design

The canvas system employs a three-layer architecture with independent rendering control:

**Layer Stack (bottom to top):**
1. **Image Display Layer:** Source image with opacity control
2. **Prediction Mask Layer:** AI-generated masks with color coding and opacity
3. **User Input Layer:** Interactive elements (points, boxes, drawn regions)

**Technical Implementation:**
* Each layer uses both visible and offscreen canvases for efficient composition
* Layers are rendered independently and composited for final display
* Individual opacity controls allow fine-tuned visualization

### 2.2. Component Responsibilities

**Canvas Manager:**
* Coordinates all canvas operations and state management
* Handles coordinate system transformations
* Manages layer composition and rendering
* Provides external API for integration with main application

**Layer Renderers:**
* **Image Renderer:** Loads, scales, and displays source images
* **Mask Renderer:** Processes server mask data and applies visualization
* **Input Renderer:** Draws and manages user interaction elements

**Event System:**
* Captures and processes user interactions
* Translates display coordinates to original image coordinates
* Dispatches events to main application for backend communication

### 2.3. Data Flow and State Management

**Data Sources:**
* **Server Response Data:** Image data, mask arrays, metadata
* **User Interaction Data:** Points, boxes, drawn polygons
* **UI Control State:** Opacity settings, display modes, toggle states

**State Persistence:**
* Session-level: Opacity settings, display preferences
* Image-level: User inputs, mask selections, toggle states
* Temporary: Drawing states, interaction feedback
* In-memory cache keyed by image hash stores recent canvas state to avoid large localStorage usage

---

## 3. Canvas Layer Specifications

### 3.1. Image Display Layer

**Functionality:**
* Display source images with automatic scaling to fit display area
* Maintain aspect ratio while maximizing display size
* Support opacity adjustment (0-100%) for overlay visualization
* Handle image loading states and error conditions

**Scaling Behavior:**
* Calculate optimal display size based on container dimensions
* Maintain 1:1 pixel mapping when possible (zoom ≤ 100%)
* Provide smooth scaling for large images that exceed display area
* Preserve original image quality through appropriate sampling

**Integration Points:**
* Receives image data from server via main application
* Provides coordinate transformation functions for other layers
* Notifies main application of successful image loading

### 3.2. Prediction Mask Layer

**Functionality:**
* Render AI-generated masks from server-provided binary arrays
* Apply dynamic color generation for visual distinction
* Support multiple display modes (best, all, custom selection)
* Enable individual mask and region toggling

**Mask Data Processing:**
* **Input Format:** 2D binary arrays matching original image dimensions
* **Color Assignment:** Dynamic HSL-based color generation for optimal contrast
* **Rendering:** Convert binary data to colored ImageData for canvas display
* **Optimization:** Use offscreen canvases for complex compositions

**Toggle System:**
* **Mask-Level Toggling:** Individual control over each prediction mask
* **Region-Level Toggling:** Control over disconnected components within masks
* **Batch Operations:** Select/deselect all, invert selection

### 3.3. User Input Layer

**Functionality:**
* Display user interaction elements with distinct visual styling
* Support multiple input types with appropriate visual feedback
* Maintain interaction state during drawing operations
* Provide clear visual hierarchy over background layers

**Input Element Types:**
* **Positive Points:** Green circles indicating object inclusion
* **Negative Points:** Red circles indicating object exclusion
* **Bounding Boxes:** Blue rectangles for region specification
* **Drawn Polygons:** Yellow outlined regions for custom masks

**Visual Design:**
* Clear color coding for different input types
* Appropriate sizing for visibility and precision
* Semi-transparent styling to avoid obscuring underlying content
* White outlines for contrast against varied backgrounds

---

## 4. Mask Visualization System

### 4.1. Mask Data Processing

**Server Data Format:**
```
Response: {
    "masks_data": [
        [[0,1,0,...], [1,1,1,...], ...],  // 2D binary arrays
        [[0,0,1,...], [1,0,1,...], ...]   // Additional masks
    ],
    "scores": [0.95, 0.87, ...],          // Confidence scores
    "layer_id": "prediction_uuid"
}
```

**Processing Pipeline:**
1. **Validation:** Verify mask dimensions match original image
2. **Sorting:** Order masks by confidence score (highest first)
3. **Color Assignment:** Generate distinct colors for visualization
4. **Rendering Preparation:** Convert to ImageData format
5. **Composition:** Apply toggle states and render visible masks

### 4.2. Color Generation and Assignment

**Color Strategy:**
* **HSL Color Space:** Distribute hues evenly across color wheel
* **Dynamic Generation:** Calculate colors based on mask count
* **Contrast Optimization:** Adjust saturation and lightness for visibility
* **Consistency:** Maintain color assignments within annotation session

**Color Distribution Algorithm:**
* Base hue step: 360° / (mask_count * distribution_factor)
* Saturation range: 70-90% for vibrant colors
* Lightness range: 55-65% for optimal contrast
* Alpha channel: 100% opacity for generated colors; layer transparency controlled by slider

### 4.3. Rendering Pipeline

**Mask Composition Process:**
1. **Preparation:** Create offscreen canvas matching display dimensions
2. **Pixel Processing:** Convert binary mask to colored ImageData
3. **Region Rendering:** Apply colors to mask pixels (value === 1)
4. **Layer Composition:** Composite individual masks onto prediction layer
5. **Final Display:** Apply opacity and render to visible canvas

**Performance Optimizations:**
* **Selective Rendering:** Only process visible/toggled masks
* **Canvas Reuse:** Maintain pool of temporary canvases
* **Progressive Updates:** Render large mask sets incrementally
* **Memory Management:** Clear unused ImageData objects promptly

### 4.4. Opacity and Visibility Controls

**Opacity Control System:**
* **Independent Sliders:** Separate controls for each layer (0-100%)
* **Real-time Updates:** Immediate visual feedback on slider changes
* **Preserved Settings:** Maintain opacity preferences across images
* **Performance:** Use canvas globalAlpha for efficient opacity application

**Visibility Logic:**
* **Layer Visibility:** Controlled by opacity sliders
* **Mask Visibility:** Controlled by individual toggle states
* **Combined Effect:** Apply both opacity and toggle state for final visibility

---

## 5. User Interaction System

### 5.1. Input Method Specifications

**Point Annotation:**
* **Positive Points (Left Click):** Green circles, label value = 1
* **Negative Points (Right Click):** Red circles, label value = 0
* **Point Removal:** Click near existing point (within threshold distance)
* **Visual Feedback:** Immediate display update on interaction

**Box Annotation (multiple supported):**
* **Box Drawing (Shift + Drag):** Blue rectangle indicating region; multiple boxes may be drawn. 
  * Limit box area to within the image, but track mouse movement even outside image. 
  * Only finish box drawing when mouse is released. 
  * This helps prevent accidental box completion when mouse is moved slightly out of the image or canvas.
* **Box Removal:** Shift-click inside an existing box
* **Real-time Preview:** Show box outline during drag operation
* **Constraint Handling:** Ensure minimum box size for meaningful input
* **Multiple Boxes:** Several boxes can be drawn concurrently; each is kept until manually removed

**Polygon Drawing:**
* **Lasso Mode (Ctrl + Drag):** Draw freeform polygon regions
* **Polygon Removal:** Ctrl + click inside existing polygon
* **Auto-closure:** Automatically close polygon on interaction end
* **Visual Feedback:** Show drawing path and final filled region

### 5.2. Interactive Canvas Controls

**Mouse Event Handling:**
* **Event Capture:** Handle mousedown, mousemove, mouseup, mouseleave
* **Modifier Key Support:** Shift, Ctrl/Cmd for different interaction modes
* **Context Menu Prevention:** Disable right-click menu for negative points
* **Interaction State Tracking:** Maintain drawing state across events

**Touch Support (Future):**
* **Touch Events:** Support touch-based interaction for mobile devices
* **Gesture Recognition:** Map touch gestures to interaction modes
* **Pressure Sensitivity:** Utilize pressure data where available

### 5.3. Coordinate System Management

**Coordinate Transformations:**
* **Display to Original:** Convert canvas coordinates to original image space
* **Original to Display:** Convert original coordinates for rendering
* **Precision Handling:** Maintain sub-pixel accuracy where appropriate
* **Boundary Checking:** Ensure coordinates remain within valid ranges

**Scaling Considerations:**
* **Responsive Scaling:** Handle canvas resize events
* **Zoom Support:** Maintain interaction accuracy across zoom levels
* **Aspect Ratio:** Preserve correct coordinate mapping

### 5.4. Event Handling and State Updates

**Interaction Event Flow:**
1. **User Input:** Mouse/touch interaction on canvas
2. **Event Processing:** Determine interaction type and target
3. **State Update:** Modify internal interaction state
4. **Visual Update:** Re-render affected canvas layers
5. **External Notification:** Dispatch events to main application

**State Management:**
* **Interaction State:** Track current drawing operations
* **Input History:** Maintain undo/redo capability
* **Change Detection:** Identify when interaction affects server communication

---

## 6. Mask Management and Selection

### 6.1. Prediction Visibility

The canvas exposes controls for selecting which predictions are visible. When a
single box (or only point prompts) is used with `multimask_output=true`, the
predictor returns three masks ranked by score. Exactly one of these masks is
shown at a time and the user can switch between them via radio buttons labeled
**High**, **Medium**, and **Low**. The chosen mask remains active for subsequent
predictions until the inputs are cleared. When multiple boxes are provided,
`multimask_output` is forced to `false` and one mask is returned for each box.
In this case all masks are displayed automatically and the selector is hidden.
The last placed box corresponds to the last mask in the returned list so mask
order mirrors input order.

### 6.2. Individual Mask Toggling

**Toggle Interface:**
* **Radio Selector (multimask results):** When a single box/point prompt is used the three score-ranked masks are presented as radio buttons (**High**, **Medium**, **Low**). Only one mask can be active at a time.
* **Automatic Masks:** For masks from the automatic generator a list of checkboxes remains so each mask can be toggled individually.
* **Multi-Box Predictions:** No toggle controls are shown. All returned masks are displayed simultaneously.
* **Dynamic Labels:** Box-based predictions are ordered so that the last drawn box corresponds to the last mask.
* **Keyboard Shortcuts:** Space to toggle, A for all (automatic masks), N for none

**Toggle State Management:**
* **Per-Mask State:** Track visibility for each individual mask
* **Session Persistence:** Maintain toggle states during annotation session
* **Reset Behavior:** Default to "all visible" for new predictions

### 6.3. Multi-Region Mask Handling

**Connected Component Analysis:**
* **Region Detection:** Identify disconnected components within masks
* **Individual Control:** Enable toggling of separate regions
* **Visual Distinction:** Subtle indicators for multi-region masks
* **Performance:** Efficient processing for complex masks

**Region Management:**
* **Hierarchical Structure:** Mask → Regions → Pixels
* **Selection Logic:** Support partial mask selection via regions
* **Export Consideration:** Track which regions contribute to final masks

### 6.4. Selection State Management

**Selection Tracking:**
* **Current Selection:** Track which masks/regions are visible/selected
* **Selection History:** Enable undo/redo for selection changes
* **Export Preparation:** Identify selected content for final mask compilation

**Integration with Editing:**
* **Post-Processing Input:** Selected masks form basis for manual editing
* **Drawing Integration:** Combine selected masks with user-drawn regions
* **Final Composition:** Merge selections for commit_masks operation

---

## 7. Backend Integration

### 7.1. API Communication Patterns

**Image Loading:**
* **Trigger:** Canvas receives image data from main application
* **Processing:** Load image, set dimensions, initialize canvas state
* **Notification:** Inform main application of successful loading

**Prediction Display:**
* **Trigger:** Receive mask data from server via main application
* **Processing:** Parse mask arrays, generate colors, render predictions
* **State Update:** Clear previous predictions, apply new visualization

**User Interaction:**
* **Trigger:** User modifies inputs (points, boxes, polygons)
* **Processing:** Update internal state, re-render affected layers
* **Notification:** Dispatch interaction events with current input state

### 7.2. Data Format Specifications

**Incoming Data (from server):**
```javascript
// Image data
{
    "image_data": "data:image/jpeg;base64,...",
    "width": 1920,
    "height": 1080,
    "filename": "image.jpg"
}

// Mask predictions
{
    "masks_data": [/* 2D binary arrays */],
    "scores": [/* confidence scores */],
    "layer_id": "prediction_uuid",
    "multimask_output": true,
    "num_boxes": 1
}
```

**Outgoing Data (to main application):**
```javascript
// User interactions
{
    "points": [{"x": 100, "y": 150, "label": 1}],
    "boxes": [[50, 75, 200, 225]],
    "maskInput": [/* 256x256 binary array */]
}
// When no points are present, "points" and "labels" are sent as null rather than empty arrays.
// If multiple boxes are provided, the client forces multimask_output=false so one mask is returned per box.

// Selection state
{
    "selectedMasks": [0, 2, 4],  // indices of selected masks
    "maskToggles": [true, false, true, false, true]
}
```

### 7.3. State Synchronization

**Canvas State Export:**
* **Current Inputs:** Points, boxes, drawn regions in original coordinates
* **Selection State:** Which masks/regions are currently selected/visible
* **Display Settings:** Opacity levels, display modes, visual preferences
* **Image Context:** Current image dimensions, scaling factors

**State Import/Restoration:**
* **Session Restoration:** Reload previous state when returning to image
* **Cross-Session Persistence:** Maintain user preferences across sessions
* **Default State:** Establish sensible defaults for new images/sessions
* **In-Memory Cache:** Image states are cached while the page is open to allow switching between images without losing work

**Synchronization Events:**
* **Input Changes:** Immediate dispatch when user modifies inputs
* **Selection Changes:** Notify when mask visibility/selection changes
* **Mode Changes:** Communicate display mode and setting changes

---

## 8. Performance and Optimization

### 8.1. Rendering Optimizations

**Canvas Rendering Strategy:**
* **Offscreen Composition:** Use offscreen canvases for complex operations
* **Selective Redraw:** Only re-render changed layers/regions
* **Frame Rate Management:** Throttle updates during continuous interactions
* **GPU Acceleration:** Leverage hardware acceleration where available

**Memory Management:**
* **Canvas Pooling:** Reuse temporary canvases to reduce allocation overhead
* **ImageData Caching:** Cache processed mask data for repeated rendering
* **Garbage Collection:** Proactively clear unused objects and references
* **Resource Monitoring:** Track memory usage for large image sets

**Large Image Handling:**
* **Progressive Loading:** Display images progressively as data arrives
* **Tiled Rendering:** Break large images into manageable tiles
* **Level-of-Detail:** Adjust rendering quality based on zoom level
* **Viewport Culling:** Only process visible portions of large canvases

### 8.2. Memory Management

**Memory Allocation Strategy:**
* **Pre-allocation:** Reserve canvas buffers for common operations
* **Pool Management:** Maintain pools of reusable objects
* **Cleanup Scheduling:** Regular cleanup of unused resources
* **Memory Monitoring:** Track usage patterns and optimize accordingly

**Large Dataset Handling:**
* **Streaming Rendering:** Process large mask sets incrementally
* **Priority Loading:** Load visible/selected masks first
* **Background Processing:** Use web workers for intensive operations
* **Cache Management:** Intelligent caching with size limits

### 8.3. Progressive Loading

**Mask Set Loading:**
* **Priority Order:** Load highest-confidence masks first
* **Batch Processing:** Process masks in small batches to maintain responsiveness
* **User Feedback:** Show loading progress for large operations
* **Cancellation Support:** Allow users to cancel long-running operations

**Interactive Response:**
* **Immediate Feedback:** Show interaction results instantly
* **Background Updates:** Process complex operations asynchronously
* **State Consistency:** Maintain consistent state during progressive operations

---

## 9. Error Handling and Edge Cases

### 9.1. Input Validation and Sanitization

**Coordinate Validation:**
* **Boundary Checking:** Ensure coordinates remain within image bounds
* **Type Validation:** Verify coordinate data types and formats
* **Range Validation:** Check for reasonable coordinate values
* **Transformation Errors:** Handle coordinate system conversion failures

**Data Format Validation:**
* **Mask Dimension Verification:** Ensure mask arrays match image dimensions
* **Binary Data Validation:** Verify mask values are 0/1 or boolean
* **Score Validation:** Check confidence scores are valid numeric values
* **Structure Validation:** Verify response data structure integrity

### 9.2. Error Recovery Strategies

**Rendering Failures:**
* **Graceful Degradation:** Fall back to simpler rendering methods
* **Error Isolation:** Prevent single mask errors from breaking entire display
* **User Notification:** Inform users of rendering issues with clear messages
* **Retry Mechanisms:** Automatic retry for transient failures

**Memory/Performance Issues:**
* **Resource Throttling:** Reduce quality/features when resources are limited
* **Emergency Cleanup:** Aggressive cleanup when memory limits approached
* **User Controls:** Allow users to reduce load (hide masks, lower quality)
* **Monitoring Integration:** Report performance issues to main application

### 9.3. Edge Case Handling

**Empty/Invalid Data:**
* **No Masks:** Handle predictions with zero masks gracefully
* **Empty Regions:** Process masks with no pixels appropriately
* **Invalid Scores:** Handle missing or invalid confidence scores
* **Corrupted Data:** Detect and handle corrupted mask data

**Unusual Image Properties:**
* **Very Large Images:** Handle images exceeding typical size limits
* **Very Small Images:** Maintain usability with small images
* **Extreme Aspect Ratios:** Handle very wide or very tall images
* **Zero-Size Dimensions:** Guard against invalid image dimensions

**Interaction Edge Cases:**
* **Rapid Interactions:** Handle very fast user input sequences
* **Simultaneous Inputs:** Process overlapping interaction events
* **Boundary Interactions:** Handle clicks exactly on element boundaries
* **Device Variations:** Account for different input device characteristics

---

## 10. Future Considerations

### 10.1. Advanced Visualization Features

**Enhanced Display Options:**
* **Mask Opacity Per-Mask:** Individual opacity controls for each mask
* **Color Themes:** Predefined color schemes for different use cases
* **Outline Mode:** Show only mask boundaries instead of filled regions
* **Animation Support:** Smooth transitions for mask changes

**Advanced Selection Tools:**
* **Magic Wand Selection:** Click-to-select similar regions
* **Brush Selection:** Paint-based selection of mask regions
* **Geometric Selection:** Circle, polygon, and freeform selection tools
* **AI-Assisted Selection:** Intelligent region growing and selection refinement

### 10.2. Collaboration Features

**Multi-User Support:**
* **Real-time Collaboration:** Multiple users working on same image
* **Conflict Resolution:** Handle simultaneous edits gracefully
* **User Indicators:** Show other users' cursors and active areas
* **Version Control:** Track and merge changes from multiple users

**Annotation Sharing:**
* **Export Configurations:** Save and share canvas settings
* **Template Systems:** Reusable annotation templates
* **Review Workflows:** Support for annotation review and approval

### 10.3. Accessibility Improvements

**Visual Accessibility:**
* **High Contrast Modes:** Enhanced visibility for low-vision users
* **Color Blind Support:** Alternative color schemes and patterns
* **Zoom Integration:** Seamless integration with browser zoom
* **Screen Reader Support:** Proper labeling and description

**Interaction Accessibility:**
* **Keyboard Navigation:** Full keyboard control of canvas functions
* **Voice Control:** Voice command support for common operations
* **Alternative Input:** Support for specialized input devices
* **Simplified Modes:** Reduced complexity modes for different user needs

### 10.4. Performance Enhancements

**Advanced Optimization:**
* **WebGL Rendering:** GPU-accelerated rendering for complex scenes
* **Web Workers:** Background processing for intensive operations
* **Streaming Protocols:** Efficient data streaming for large datasets
* **Caching Strategies:** Advanced caching with predictive pre-loading

**Platform Integration:**
* **Native App Integration:** Embedded canvas in native applications
* **Mobile Optimization:** Touch-optimized interface for mobile devices
* **Progressive Web App:** Offline capability and app-like experience
* **Cloud Integration:** Direct integration with cloud storage and processing

---

## Conclusion

This specification provides a comprehensive guide for implementing the canvas system as a core component of the SAM2 Image Masking Web Application. The multi-layered architecture, robust interaction model, and efficient rendering pipeline ensure a responsive and intuitive user experience while maintaining clean integration with the backend AI processing system.

The canvas system serves as the primary interface between users and the SAM2 AI model, translating user intentions into precise inputs and presenting AI outputs in an immediately understandable visual format. By following this specification, developers can create a canvas implementation that scales from simple point-and-click interactions to complex multi-mask annotation workflows.

**Implementation Priority:**
1. **Core Architecture:** Multi-layer canvas system with basic rendering
2. **Essential Interactions:** Point, box, and polygon input methods
3. **Mask Visualization:** Basic mask display with color coding and opacity
4. **Toggle System:** Individual mask and region visibility controls
5. **Advanced Features:** Progressive loading, performance optimizations
6. **Future Enhancements:** Collaboration, accessibility, advanced tools

This specification should be used in conjunction with the main `specification.md` document to understand the complete system context and integration requirements.
