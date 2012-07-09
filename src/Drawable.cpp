/* 
 * File:   Drawable.cpp
 * Author: Brian
 * 
 * Created on June 16, 2012, 9:29 PM
 */


#include "Drawable.h"
#include <string.h>
using namespace std;

Drawable::Drawable(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk)
        : x(x),
        y(y),
        c(c),
        fore(fore),
        back(back),
        trans(trans),
        walk(walk)
{
}

Drawable::Drawable(int c, TCODColor fore, TCODColor back, bool trans, bool walk)
        :
        x(0), // temp
        y(8), // temp
        c(c),
        fore(fore),
        back(back),
        trans(trans),
        walk(walk)
{
}

Drawable::Drawable(int x, int y, int c) 
        :x(x),
        y(y),
        c(c),
        fore(TCODColor::white),
        back(TCODColor::black),
        trans(false),
        walk(false)
{
}

Drawable::~Drawable() 
{
}

void Drawable::setX(int x) 
{
    this->x = x;
}

void Drawable::setY(int y)
{
    this->y = y;
}

bool Drawable::moveRight()
{
    //implement using gameplay.mapPosx, etc. to define these values
    if (x < 76)
    {
        x++;
        return true;
    }
    return false;
}

bool Drawable::moveDown()
{
    if (y < 53)
    {
        y++;
        return true;   
    }
    return false;
}

bool Drawable::moveLeft()
{
    if (x > 1)
    {
        x--;
        return true;
    } 
    return false;
}

bool Drawable::moveUp()
{
    if (y > 9)
    {   
        y--;
        return true;
    }
    return false;
}

bool Drawable::moveUpLeft()
{
    if (x > 1 && y > 9)
    {
        x--;
        y--;
        return true;
    } 
    return false;
}

bool Drawable::moveDownLeft()
{
    if (x > 1 && y < 53)
    {
        x--;
        y++;
        return true;
    } 
    return false;
}

bool Drawable::moveUpRight()
{
    if (x < 76 && y > 9)
    { //implement using gameplay.mapPosx, etc. to define these values
        x++;
        y--;
        return true;
    }
    return false;
}

bool Drawable::moveDownRight()
{
    if (x < 76 && y < 53){ //implement using gameplay.mapPosx, etc. to define these values
        x++;
        y++;
        return true;
    }
    return false;
}

void Drawable::draw()
{
    TCODConsole::root->putCharEx(x, y, c, fore, back);
}

int Drawable::returnx(){
   return x;
}

int Drawable::returny(){
   return y;
}

int Drawable::returnz(){
   return c;
}

TCODColor Drawable::returnfore(){
   return fore;
}

TCODColor Drawable::returnback(){
   return back;
}

bool Drawable::returntrans(){
    return trans;
}

bool Drawable::returnwalk(){
    return walk;
}

