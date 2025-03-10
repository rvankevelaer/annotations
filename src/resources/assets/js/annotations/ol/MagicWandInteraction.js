/**
 * Control for drawing polygons using fuzzy matching of colors.
 */
biigle.$declare('annotations.ol.MagicWandInteraction', function () {
    function MagicWandInteraction(options) {
        ol.interaction.Pointer.call(this, {
            handleUpEvent: this.handleUpEvent,
            handleDownEvent: this.handleDownEvent,
            handleMoveEvent: this.handleMoveEvent,
            handleDragEvent: this.handleDragEvent,
        });

        this.on('change:active', this.toggleActive);

        // The image layer to use as source for the magic wand tool.
        this.layer = options.layer;

        // Initial color threshold for all sketches.
        this.colorThreshold = options.colorThreshold === undefined ? 15 :
            options.colorThreshold;
        // Current color threshold that is continuously updated while a sketch is drawn.
        this.currentThreshold = this.colorThreshold;

        // Blur radius to use for simplifying the computed area of the sketch.
        this.blurRadius = options.blurRadius === undefined ? 5 :
            options.blurRadius;

        // Value to adjust simplification of the sketch polygon. Higher values result in
        // less vertices of the polygon. Set to 0 to disable simplification.
        this.simplifyTolerant = options.simplifyTolerant === undefined ? 0 :
            options.simplifyTolerant;
        // Minimum number of required vertices for the simplified polygon.
        this.simplifyCount = options.simplifyCount === undefined ? 3 :
            options.simplifyCount;

        // Coordinates of the initial mousedown event.
        this.downPoint = [0, 0];
        this.map = options.map;

        // Canvas element to draw the snapshot of the current view of the image layer to.
        this.snapshotCanvas = document.createElement('canvas');
        this.snapshotContext = this.snapshotCanvas.getContext('2d');
        // MagicWand image object of the snapshot.
        this.snapshot = null;
        // Specifies whether the snapshot is currently updated. This is required to avoid
        // infinite recursion because the moveend event triggers the update but the
        // update in turn triggers a moveend event.
        this.updatingSnapshot = false;

        // If the mouse is inside of this radius (in px) around the downPoint while
        // drawing a sketch and the mouse button is released, the sketch is discarded.
        // If the button is released outside the radius, the sketch will be emitted as
        // new feature.
        this.discardRadius = options.discardRadius === undefined ? 20 :
            options.discardRadius;

        this.sketchFeature = null;
        this.sketchSource = options.source;

        if (this.sketchSource === undefined) {
            this.sketchSource = new ol.source.Vector();
            this.map.addLayer(new ol.layer.Vector({
                source: this.sketchSource,
                zIndex: 200,
            }));
        }

        this.sketchStyle = options.style === undefined ? null : options.style;

        // The point that indicates the downPoint where drawing of the sketch started.
        this.isShowingPoint = false;
        this.indicatorPoint = new ol.Feature(new ol.geom.Point([20, 20]));
        if (options.indicatorPointStyle !== undefined) {
            this.indicatorPoint.setStyle(options.indicatorPointStyle);
        }
        // The "x" that indicates that the current sketch will be discarded because the
        // mouse is near the downPoint.
        this.isShowingCross = false;
        this.indicatorCross = new ol.Feature(new ol.geom.Point([100, 100]));
        if (options.indicatorCrossStyle !== undefined) {
            this.indicatorCross.setStyle(options.indicatorCrossStyle);
        } else {
            this.indicatorCross.setStyle([
                new ol.style.Style({
                    image: new ol.style.RegularShape({
                        stroke: new ol.style.Stroke({
                            color: [0, 153, 255, 1],
                            width: 3,
                        }),
                        points: 4,
                        radius1: 6,
                        radius2: 0,
                        angle: Math.PI / 4
                    })
                }),
                new ol.style.Style({
                    image: new ol.style.RegularShape({
                        stroke: new ol.style.Stroke({
                            color: [255, 255, 255, 0.75],
                            width: 1.5,
                        }),
                        points: 4,
                        radius1: 6,
                        radius2: 0,
                        angle: Math.PI / 4
                    })
                }),
            ]);
        }
        this.indicatorSource = new ol.source.Vector();
        this.map.addLayer(new ol.layer.Vector({
            source: this.indicatorSource,
            zIndex: 200,
        }));

        // Update the snapshot and set event listeners if the interaction is active.
        this.toggleActive();
    }

    ol.inherits(MagicWandInteraction, ol.interaction.Pointer);

    /**
     * Scaling factor of high DPI displays. The snapshot will be by a factor of
     * 'scaling' larger than the map so we have to include this factor in the
     * transformation of the mouse position.
     *
     * @return {Float}
     */
    MagicWandInteraction.prototype.getHighDpiScaling = function () {
        return this.snapshot.height / this.map.getSize()[1];
    };

    /**
     * Convert OpenLayers coordinates on the image layer to coordinates on the snapshot.
     *
     * @param {Array} points
     *
     * @return {Array}
     */
    MagicWandInteraction.prototype.toSnapshotCoordinates = function (points) {
        var extent = this.map.getView().calculateExtent(this.map.getSize());
        var height = this.snapshot.height;
        var factor = this.getHighDpiScaling() / this.map.getView().getResolution();

        return points.map(function (point) {
            return [
                Math.round((point[0] - extent[0]) * factor),
                height - Math.round((point[1] - extent[1]) * factor),
            ];
        });
    };

    /**
     * Convert coordinates on the snapshot to OpenLayers coordinates on the image layer.
     *
     * @param {Array} points
     *
     * @return {Array}
     */
    MagicWandInteraction.prototype.fromSnapshotCoordinates = function (points) {
        var extent = this.map.getView().calculateExtent(this.map.getSize());
        var height = this.snapshot.height;
        var factor = this.map.getView().getResolution() / this.getHighDpiScaling();

        return points.map(function (point) {
            return [
                Math.round((point[0] * factor) + extent[0]),
                Math.round(((height - point[1]) * factor) + extent[1]),
            ];
        });
    };

    /**
     * Convert MagicWand point objects to OpenLayers point arrays.
     *
     * @param {Array} points
     *
     * @return {Array}
     */
    MagicWandInteraction.prototype.fromMagicWandCoordinates = function (points) {
        return points.map(function (point) {
            return [point.x, point.y];
        });
    };

    /**
     * Finish drawing of a sketch.
     */
    MagicWandInteraction.prototype.handleUpEvent = function (e) {
        this.currentThreshold = this.colorThreshold;

        if (this.isShowingCross) {
            this.sketchSource.removeFeature(this.sketchFeature);
        } else {
            this.dispatchEvent({type: 'drawend', feature: this.sketchFeature});
        }

        this.sketchFeature = null;

        this.indicatorSource.clear();
        this.isShowingPoint = false;
        this.isShowingCross = false;

        return false;
    };

    /**
     * Start drawing of a sketch.
     */
    MagicWandInteraction.prototype.handleDownEvent = function (e) {
        this.downPoint[0] = Math.round(e.coordinate[0]);
        this.downPoint[1] = Math.round(e.coordinate[1]);
        this.drawSketch();
        this.indicatorPoint.getGeometry().setCoordinates(this.downPoint);
        this.indicatorCross.getGeometry().setCoordinates(this.downPoint);
        this.indicatorSource.clear();
        this.indicatorSource.addFeature(this.indicatorCross);
        this.isShowingCross = true;
        this.isShowingPoint = false;

        return true;
    };

    /**
     * Update the currently drawn sketch.
     */
    MagicWandInteraction.prototype.handleDragEvent = function (e) {
        var coordinate = this.toSnapshotCoordinates([e.coordinate]).shift();
        var x = Math.round(coordinate[0]);
        var y = Math.round(coordinate[1]);
        var point = this.toSnapshotCoordinates([this.downPoint]).shift();
        var px = point[0];
        var py = point[1];

        // Color threshold calculation. Inspired by the MagicWand example:
        // http://jsfiddle.net/Tamersoul/dr7Dw/
        if (x !== px || y !== py) {
            var dx = x - px;
            var dy = y - py;
            var len = Math.sqrt(dx * dx + dy * dy);
            // Ignore the discard radius if the shift key is pressed.
            // see: https://github.com/biigle/annotations/issues/116
            if (len <= this.discardRadius && !e.originalEvent.shiftKey) {
                if (!this.isShowingCross) {
                    this.indicatorSource.clear();
                    this.indicatorSource.addFeature(this.indicatorCross);
                    this.isShowingCross = true;
                    this.isShowingPoint = false;
                }
            } else if (!this.isShowingPoint) {
                this.indicatorSource.clear();
                this.indicatorSource.addFeature(this.indicatorPoint);
                this.isShowingCross = false;
                this.isShowingPoint = true;
            }

            var thres = Math.min(Math.max(this.colorThreshold + Math.round(len / 2 - this.colorThreshold), 1), 255);
            if (thres != this.currentThreshold) {
                this.currentThreshold = thres;
                this.drawSketch();
            }
        }
    };

    /**
     * Update the target point.
     */
    MagicWandInteraction.prototype.handleMoveEvent = function (e) {
        if (!this.isShowingPoint) {
            this.indicatorSource.clear();
            this.indicatorSource.addFeature(this.indicatorPoint);
            this.isShowingPoint = true;
            this.isShowingCross = false;
        }
        this.indicatorPoint.getGeometry().setCoordinates(e.coordinate);
    };

    /**
     * Update event listeners depending on the active state of the interaction.
     */
    MagicWandInteraction.prototype.toggleActive = function () {
        if (this.getActive()) {
            this.map.on(['moveend', 'change:size'], this.updateSnapshot.bind(this));
            this.updateSnapshot();
        } else {
            this.map.un(['moveend', 'change:size'], this.updateSnapshot.bind(this));
            this.indicatorSource.clear();
            this.isShowingPoint = false;
            this.isShowingCross = false;
            if (this.sketchFeature) {
                this.sketchSource.removeFeature(this.sketchFeature);
                this.sketchFeature = null;
            }
        }
    };

    /**
     * Update the snapshot of the image layer.
     */
    MagicWandInteraction.prototype.updateSnapshot = function () {
        if (!this.updatingSnapshot && this.layer) {
            this.layer.once('postcompose', this.updateSnapshotCanvas.bind(this));
            // Set flag to avoid infinite recursion since renderSync will trigger the
            // moveend event again!
            this.updatingSnapshot = true;
            this.map.renderSync();
            this.updatingSnapshot = false;
        }
    };

    /**
     * Update the snapshot canvas.
     */
    MagicWandInteraction.prototype.updateSnapshotCanvas = function (e) {
        this.snapshotCanvas.width = e.context.canvas.width;
        this.snapshotCanvas.height = e.context.canvas.height;
        this.snapshotContext.drawImage(e.context.canvas, 0, 0);
        this.snapshot = this.snapshotContext.getImageData(0, 0, this.snapshotCanvas.width, this.snapshotCanvas.height);
        this.snapshot.bytes = 4;
    };

    /**
     * Update the layer to get the image information from.
     */
    MagicWandInteraction.prototype.setLayer = function (layer) {
        this.layer = layer;
    };

    /**
     * Recompute the currently drawn sketch.
     */
    MagicWandInteraction.prototype.drawSketch = function () {
        var point = this.toSnapshotCoordinates([this.downPoint]).shift();
        var sketch = MagicWand.floodFill(this.snapshot, point[0], point[1], this.currentThreshold);

        if (this.blurRadius > 0) {
            sketch = MagicWand.gaussBlurOnlyBorder(sketch, this.blurRadius);
        }

        // Crop the detected region of the sketch to the actual image extent. Wherever
        // the snapshot is transparent, there should not be a detected region.
        var sketchData = sketch.data;
        var snapshotData = this.snapshot.data;
        for (var i = sketchData.length - 1; i >= 0; i--) {
            if (snapshotData[i * 4] === 0) {
                sketchData[i] = 0;
            }
        }

        // Take only the outer contour.
        var contour = MagicWand.traceContours(sketch)
            .filter(function (c) {
                return !c.innner;
            })
            .shift();

        if (contour) {
            if (this.simplifyTolerant > 0) {
                contour = MagicWand.simplifyContours([contour], this.simplifyTolerant, this.simplifyCount).shift();
            }

            var points = this.fromSnapshotCoordinates(this.fromMagicWandCoordinates(contour.points));

            if (this.sketchFeature) {
                this.sketchFeature.getGeometry().setCoordinates([points]);
            } else {
                this.sketchFeature = new ol.Feature(new ol.geom.Polygon([points]));
                if (this.sketchStyle) {
                    this.sketchFeature.setStyle(this.sketchStyle);
                }
                this.sketchSource.addFeature(this.sketchFeature);
            }
        }
    };

    return MagicWandInteraction;
});
