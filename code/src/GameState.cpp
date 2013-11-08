#include "../include/GameState.hpp"
#include "../include/StateIdentifiers.hpp"


GameState::GameState(StateStack& stateStack)
    : State(stateStack)
{
}


GameState::~GameState()
{
}

void GameState::draw()
{
}

bool GameState::update()
{
    return false;
}

bool GameState::handleInput(TCOD_key_t key)
{
    if (key.vk == TCODK_UP)
      ;
    else if (key.vk == TCODK_DOWN)
      ;
    else if (key.vk == TCODK_LEFT)
      ;
    else if (key.vk == TCODK_RIGHT)
      ;
    else if (key.c == 'a')
        requestStackPush(States::Debug);
    return false;
}

