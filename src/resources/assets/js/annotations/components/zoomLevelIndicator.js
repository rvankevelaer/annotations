/**
 * The zoom level indicator of the canvas element
 *
 * @type {Object}
 */
biigle.$component('annotations.components.zoomLevelIndicator', {
    props: {
        resolution: {
            required: true,
        },
    },
    computed: {
        zoomLevelText: function () {
            var level = Math.round(100 / this.resolution) / 100;

            // Level may be NaN if the resolution has not been initialized.
            return (level || 0) + 'x';
        },
    },
});
