define([
    'background/model/youTubePlayerAPI',
    'background/model/settings',
    'common/enum/playerState'
], function (YouTubePlayerAPI, Settings, PlayerState) {
    'use strict';

    //  This is the actual YouTube Player API object housed within the iframe.
    var youTubePlayer = null;

    var YouTubePlayer = Backbone.Model.extend({
        defaults: {
            //  Returns the elapsed time of the currently loaded song. Returns 0 if no song is playing
            currentTime: 0,
            //  API will fire a 'ready' event after initialization which indicates the player can now respond accept commands
            ready: false,
            state: PlayerState.Unstarted,
            //  This will be set after the player is ready and can communicate its true value.
            //  Default to 50 because having the music on and audible, but not blasting, seems like the best default if we fail for some reason.
            volume: 50,
            //  This will be set after the player is ready and can communicate its true value.
            muted: false,
            loadedSongId: ''
        },
        
        //  Initialize the player by creating a YouTube Player IFrame hosting an HTML5 player
        initialize: function () {
            var self = this;
   
            //  Update the volume whenever the UI modifies the volume property.
            this.on('change:volume', function (model, volume) {
                self.set('muted', false);
                //  We want to update the youtube player's volume no matter what because it persists between browser sessions
                //  thanks to YouTube saving it -- so should keep it always sync'ed.
                youTubePlayer.setVolume(volume);
            });

            this.on('change:muted', function (model, isMuted) {

                //  Same logic here as with the volume
                if (isMuted) {
                    youTubePlayer.mute();
                } else {
                    youTubePlayer.unMute();
                }

            });

            var refreshPausedSongInterval = null;
            this.on('change:state', function (model, state) {

                clearInterval(refreshPausedSongInterval);
       
                if (state === PlayerState.Paused) {
                    //  TODO: Maybe I need to restart the whole API after 8 hours because HTTPS times out?
                    //  Start a long running timer when the player becomes paused. This is because YouTube
                    //  will expire after ~8+ hours of being loaded. This only happens if the player is paused.
                    var eightHoursInMilliseconds = 28800000;

                    refreshPausedSongInterval = setInterval(function () {
                        self.cueSongById(self.get('loadedSongId'), self.get('currentTime'));
                    }, eightHoursInMilliseconds);
                }
            });
            
            chrome.runtime.onConnect.addListener(function(port) {

                if (port.name === 'youTubeIFrameConnectRequest') {

                    port.onMessage.addListener(function (message) {
                        
                        if (message.canvasDataURL !== undefined) {
                            self.set('canvasDataUrl', message.canvasDataURL).trigger('change:canvasDataUrl');
                        }
                        
                        //  It's better to be told when time updates rather than poll YouTube's API for the currentTime.
                        if (message.currentTime !== undefined) {
                            self.set('currentTime', message.currentTime);
                        }
                        
                        //  YouTube's API for seeking/buffering doesn't fire events reliably.
                        //  Listen directly to the element for more responsive results.
                        if (message.seeking !== undefined) {
                            
                            if (message.seeking) {
                                
                                if (self.get('state') === PlayerState.Playing) {
                                    self.set('state', PlayerState.Buffering);
                                }
                                
                            } else {

                                if (self.get('state') === PlayerState.Buffering) {
                                    self.set('state', PlayerState.Playing);
                                }
                                
                            }

                        }

                    });

                }

            });

            var youTubePlayerAPI = new YouTubePlayerAPI();

            this.listenTo(youTubePlayerAPI, 'change:ready', function () {
                //  Injected YouTube code creates a global YT object with which a 'YouTube Player' object can be created.
                //  https://developers.google.com/youtube/iframe_api_reference#Loading_a_Video_Player
                youTubePlayer = new window.YT.Player('youtube-player', {
                    events: {
                        'onReady': function () {
                            this.set('muted', youTubePlayer.isMuted());
                            this.set('volume', youTubePlayer.getVolume());

                            this.pause();
                            this.set('ready', true);
                        }.bind(this),
                        'onStateChange': function (state) {
                            this.set('state', state.data);

                            //  TODO: There's a bug in YouTube's API which is causing the volume to change erratically every time I skip a song?
                            youTubePlayer.setVolume(this.get('volume'));

                        }.bind(this),
                        'onError': function (error) {
                            console.error("An error was encountered.", error);
                            //  Push the error to the foreground so it can be displayed to the user.
                            this.trigger('error', error.data);
                        }.bind(this)
                    }
                });

                $('#youtube-player').attr('src', 'https://www.youtube.com/embed/?enablejsapi=1&origin=chrome-extension:\\\\jbnkffmindojffecdhbbmekbmkkfpmjd');
            });

            youTubePlayerAPI.load();
        },
        
        //  Public method which is able to be called before the YouTube Player API is fully ready.
        //  cue's a song (pauses it when it is ready)
        cueSongById: function (songId, startSeconds) {
            if (this.get('ready')) {
                this._cueSongById(songId, startSeconds);
            } else {
                this.once('change:ready', function () {
                    this._cueSongById(songId, startSeconds);
                });
            }
        },
        
        _cueSongById: function (songId, startSeconds) {
            //  Helps for keeping things in sync when the same song reloads.
            if (this.get('loadedSongId') === songId) {
                this.trigger('change:loadedSongId');
            }

            this.set('loadedSongId', songId);

            youTubePlayer.cueVideoById({
                videoId: songId,
                startSeconds: startSeconds || 0,
                suggestedQuality: Settings.get('suggestedQuality')
            });

            //  It's helpful to keep currentTime set here because the progress bar in foreground might be visually set,
            //  but until the song actually loads -- current time isn't set.
            this.set('currentTime', startSeconds || 0);
        },
           
        //  Public method which is able to be called before the YouTube Player API is fully ready.
        //  Loads a song (plays it when it is ready)
        loadSongById: function (songId, startSeconds) {
            if (this.get('ready')) {
                this._loadSongById(songId, startSeconds);
            } else {
                this.once('change:ready', function() {
                    this._loadSongById(songId, startSeconds);
                });
            }
        },
        
        _loadSongById: function (songId, startSeconds) {
            //  Helps for keeping things in sync when the same song reloads.
            if (this.get('loadedSongId') === songId) {
                this.trigger('change:loadedSongId');
            }

            this.set('state', PlayerState.Buffering);
            this.set('loadedSongId', songId);

            youTubePlayer.loadVideoById({
                videoId: songId,
                startSeconds: startSeconds || 0,
                suggestedQuality: Settings.get('suggestedQuality')
            });
        },
        
        isPlaying: function () {
            return this.get('state') === PlayerState.Playing;
        },
        
        mute: function () {
            this.set('muted', true);

            youTubePlayer.mute();
        },
        
        unMute: function () {
            this.set('muted', false);
            youTubePlayer.unMute();
        },

        stop: function () {
            this.set('state', PlayerState.Unstarted);
            youTubePlayer.stopVideo();
            this.set('loadedSongId', '');

            //  Stop is only called when there's no other items to queue up - set time back to 0 since
            //  a new song won't queue up and set its time.
            this.set('currentTime', 0);
        },

        pause: function () {
            youTubePlayer.pauseVideo();
        },
            
        play: function () {
            if (!this.isPlaying()) {
                this.set('state', PlayerState.Buffering);
                youTubePlayer.playVideo();
            }
        },
        
        //  Once the Player indicates is loadedSongId has changed (to the song just selected in the stream) 
        //  Call play to change from cueing the song to playing, but let the stack clear first because loadedSongId
        //  is set just before cueSongById has finished.
        playOnceSongChanges: function() {
            var self = this;

            this.once('change:loadedSongId', function () {
                setTimeout(function () {
                    self.play();
                });
            });
        },

        seekTo: _.debounce(function (timeInSeconds) {
            var state = this.get('state');
            
            if (state === PlayerState.Unstarted || state === PlayerState.SongCued) {
                this.cueSongById(this.get('loadedSongId'), timeInSeconds);
                this.set('currentTime', timeInSeconds);
            } else {
                //  The true paramater allows the youTubePlayer to seek ahead past what is buffered.
                youTubePlayer.seekTo(timeInSeconds, true);
            }
        }, 100),
        
        //  Attempt to set playback quality to suggestedQuality or highest possible.
        setSuggestedQuality: function(suggestedQuality) {
            youTubePlayer.setPlaybackQuality(suggestedQuality);
        }
    });

    //  Exposed globally so that the foreground can access the same instance through chrome.extension.getBackgroundPage()
    window.YouTubePlayer = new YouTubePlayer();
    return window.YouTubePlayer;
});