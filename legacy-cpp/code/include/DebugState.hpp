#ifndef _DebugState_hpp_
#define _DebugState_hpp_

#include "State.hpp"
#include <libtcod.hpp>

class DebugState : public State
{
    public:
    DebugState(StateStack& stateStack);
    ~DebugState();

    void draw();
    bool update();
    bool handleInput(TCOD_key_t key);

    private:
};

#endif // _DebugState_hpp_
