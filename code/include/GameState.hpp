#ifndef _GameState_hpp_
#define _GameState_hpp_

#include "State.hpp"
#include <libtcod.hpp>

class GameState : public State
{
    public:
    GameState(StateStack& stateStack);
    ~GameState();

    void draw();
    bool update();
    bool handleInput(TCOD_key_t key);

    private:

};

#endif // _GameState_hpp_
