﻿define([
    'foreground/view/behavior/tooltip',
    'text!template/contextMenuItem.html'
], function (Tooltip, ContextMenuItemTemplate) {
    'use strict';

    var ContextMenuItemView = Backbone.Marionette.ItemView.extend({
        tagName: 'li',
        className: 'clickable',
        template: _.template(ContextMenuItemTemplate),

        events: {
            'click': 'onClick',
        },

        attributes: function () {
            return {
                title: this.model.get('title')
            };
        },
        
        behaviors: {
            Tooltip: {
                behaviorClass: Tooltip
            }
        },

        onRender: function () {
            this.setState();
        },

        setState: function () {
            this.$el.toggleClass('disabled', this.model.get('disabled'));
        },

        onClick: function () {
            if (this.$el.hasClass('disabled')) {
                return false;
            }

            this.model.get('onClick')();
        }
    });

    return ContextMenuItemView;
});